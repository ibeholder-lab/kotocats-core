#!/usr/bin/env bash

set -Eeuo pipefail

SOURCE_DIR="/opt/kotocats-core"
REMOTE_HOST="kotobot-prod"
REMOTE_DIR="/opt/kotocats-core"

PROJECT_NAME="kotocats-core"

# Сначала перезапускается само ядро, затем приложения, которые от него зависят.
PM2_PROCESSES=("core" "site" "cafe" "bot")

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

LOCAL_ARCHIVE="/tmp/${PROJECT_NAME}-${TIMESTAMP}.tar.gz"
REMOTE_ARCHIVE="/tmp/${PROJECT_NAME}-${TIMESTAMP}.tar.gz"
REMOTE_STAGE="/tmp/${PROJECT_NAME}-stage-${TIMESTAMP}"
REMOTE_BACKUP="/opt/backups/${PROJECT_NAME}-${TIMESTAMP}"

SOURCE_PARENT="$(dirname "${SOURCE_DIR}")"
SOURCE_NAME="$(basename "${SOURCE_DIR}")"

cleanup_local() {
  rm -f "${LOCAL_ARCHIVE}"
}

trap cleanup_local EXIT

echo
echo "======================================================"
echo "        ДЕПЛОЙ KOTOCATS-CORE НА ПРОД"
echo "======================================================"
echo
echo "Источник:        ${SOURCE_DIR}"
echo "Прод-сервер:     ${REMOTE_HOST}"
echo "Папка на проде:  ${REMOTE_DIR}"
echo "Бэкап:           ${REMOTE_BACKUP}"
echo
echo "Продовые .env-файлы и runtime-данные не заменяются."
echo "При ошибке после начала установки будет выполнен откат."
echo

read -r -p "Начать деплой kotocats-core на ПРОД? Введите да или нет: " ANSWER

case "${ANSWER}" in
  да|Да|ДА|yes|Yes|YES|y|Y)
    ;;
  *)
    echo
    echo "Деплой отменён."
    exit 0
    ;;
esac

echo
echo "[1/7] Проверка проекта на test..."

if [ ! -d "${SOURCE_DIR}" ]; then
  echo "Ошибка: папка ${SOURCE_DIR} не найдена."
  exit 1
fi

if [ ! -f "${SOURCE_DIR}/package.json" ]; then
  echo "Ошибка: файл ${SOURCE_DIR}/package.json не найден."
  exit 1
fi

for command_name in node ssh scp tar sha256sum find sort xargs; do
  command -v "${command_name}" >/dev/null 2>&1 || {
    echo "Ошибка: на test-сервере не найдена команда ${command_name}."
    exit 1
  }
done

cd "${SOURCE_DIR}"

node -e "
  const pkg = require('./package.json');
  console.log('Пакет:', pkg.name || 'без имени');
  console.log('Версия:', pkg.version || 'не указана');
"

echo
echo "Проверка синтаксиса JavaScript-файлов..."

while IFS= read -r -d '' file; do
  node --check "${file}"
done < <(
  find "${SOURCE_DIR}" \
    -path "${SOURCE_DIR}/node_modules" -prune -o \
    -path "${SOURCE_DIR}/.git" -prune -o \
    -path "${SOURCE_DIR}/storage" -prune -o \
    -path "${SOURCE_DIR}/media-uploads" -prune -o \
    -path "${SOURCE_DIR}/media-upload/uploads" -prune -o \
    -type f -name '*.js' -print0
)

echo "Локальная версия проверена."

echo
echo "[2/7] Проверка подключения к prod..."

ssh "${REMOTE_HOST}" "
  set -e

  export NVM_DIR=\"\$HOME/.nvm\"
  if [ -s \"\$NVM_DIR/nvm.sh\" ]; then
    . \"\$NVM_DIR/nvm.sh\"
  fi

  for command_name in rsync node npm pm2 tar sha256sum find sort xargs; do
    command -v \"\$command_name\" >/dev/null 2>&1 || {
      echo \"Ошибка: на prod не найдена команда \$command_name.\"
      exit 1
    }
  done

  test -d '${REMOTE_DIR}' || {
    echo 'Ошибка: папка ${REMOTE_DIR} на prod не найдена.'
    exit 1
  }

  test -f '${REMOTE_DIR}/package.json' || {
    echo 'Ошибка: на prod отсутствует ${REMOTE_DIR}/package.json.'
    exit 1
  }

  mkdir -p /opt/backups

  echo \"Node: \$(node -v)\"
  echo \"npm:  \$(npm -v)\"
  echo \"PM2:  \$(pm2 -v)\"
"

echo "Prod доступен."

echo
echo "[3/7] Создание архива..."

rm -f "${LOCAL_ARCHIVE}"

tar \
  --exclude="${SOURCE_NAME}/.env*" \
  --exclude="${SOURCE_NAME}/node_modules" \
  --exclude="${SOURCE_NAME}/.git" \
  --exclude="${SOURCE_NAME}/storage" \
  --exclude="${SOURCE_NAME}/media-uploads" \
  --exclude="${SOURCE_NAME}/media-upload/uploads" \
  --exclude="${SOURCE_NAME}/logs" \
  --exclude="${SOURCE_NAME}/backups" \
  --exclude="${SOURCE_NAME}/tmp" \
  --exclude="${SOURCE_NAME}/*.log" \
  --exclude="${SOURCE_NAME}/deploy-prod.sh" \
  -czf "${LOCAL_ARCHIVE}" \
  -C "${SOURCE_PARENT}" \
  "${SOURCE_NAME}"

echo "Архив создан:"
ls -lh "${LOCAL_ARCHIVE}"

echo
echo "[4/7] Копирование архива на prod..."

scp "${LOCAL_ARCHIVE}" "${REMOTE_HOST}:${REMOTE_ARCHIVE}"

echo
echo "[5/7] Установка с резервным копированием и автооткатом..."

ssh "${REMOTE_HOST}" bash -s -- \
  "${REMOTE_DIR}" \
  "${REMOTE_ARCHIVE}" \
  "${REMOTE_STAGE}" \
  "${REMOTE_BACKUP}" \
  "${PROJECT_NAME}" \
  "${SOURCE_NAME}" \
  "${PM2_PROCESSES[@]}" <<'REMOTE_SCRIPT'

set -Eeuo pipefail

export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
fi

REMOTE_DIR="$1"
REMOTE_ARCHIVE="$2"
REMOTE_STAGE="$3"
REMOTE_BACKUP="$4"
PROJECT_NAME="$5"
SOURCE_NAME="$6"

shift 6
PM2_PROCESSES=("$@")

DEPLOY_STARTED=0
ROLLBACK_RUNNING=0

process_exists() {
  local process_name="$1"

  pm2 jlist |
    node -e '
      let input = "";
      process.stdin.on("data", chunk => input += chunk);
      process.stdin.on("end", () => {
        const name = process.argv[1];
        try {
          const processes = JSON.parse(input);
          process.exit(processes.some(item => item.name === name) ? 0 : 1);
        } catch (error) {
          process.exit(1);
        }
      });
    ' "${process_name}"
}

process_status() {
  local process_name="$1"

  pm2 jlist |
    node -e '
      let input = "";
      process.stdin.on("data", chunk => input += chunk);
      process.stdin.on("end", () => {
        const name = process.argv[1];
        try {
          const processes = JSON.parse(input);
          const item = processes.find(row => row.name === name);
          process.stdout.write(item?.pm2_env?.status || "missing");
        } catch (error) {
          process.stdout.write("invalid");
        }
      });
    ' "${process_name}"
}

process_restart_count() {
  local process_name="$1"

  pm2 jlist |
    node -e '
      let input = "";
      process.stdin.on("data", chunk => input += chunk);
      process.stdin.on("end", () => {
        const name = process.argv[1];
        try {
          const processes = JSON.parse(input);
          const item = processes.find(row => row.name === name);
          process.stdout.write(String(item?.pm2_env?.restart_time ?? -1));
        } catch (error) {
          process.stdout.write("-1");
        }
      });
    ' "${process_name}"
}

install_dependencies() {
  if [ -f package-lock.json ]; then
    npm ci --omit=dev
  else
    echo "Предупреждение: package-lock.json отсутствует."
    npm install --omit=dev
  fi
}

restart_existing_processes() {
  local restarted=0

  for process_name in "${PM2_PROCESSES[@]}"; do
    if process_exists "${process_name}"; then
      echo "Перезапуск PM2-процесса: ${process_name}"
      pm2 restart "${process_name}" --update-env
      restarted=1
    else
      echo "PM2-процесс ${process_name} не найден — пропускаем."
    fi
  done

  if [ "${restarted}" -eq 1 ]; then
    sleep 5
  fi
}

check_existing_processes() {
  local failed=0

  for process_name in "${PM2_PROCESSES[@]}"; do
    if process_exists "${process_name}"; then
      local status
      status="$(process_status "${process_name}")"
      echo "PM2 ${process_name}: ${status}"

      if [ "${status}" != "online" ]; then
        failed=1
      fi
    fi
  done

  [ "${failed}" -eq 0 ]
}

check_process_stability() {
  local failed=0
  declare -A first_counts

  for process_name in "${PM2_PROCESSES[@]}"; do
    if process_exists "${process_name}"; then
      first_counts["${process_name}"]="$(process_restart_count "${process_name}")"
    fi
  done

  sleep 8

  for process_name in "${PM2_PROCESSES[@]}"; do
    if process_exists "${process_name}"; then
      local status final_count
      status="$(process_status "${process_name}")"
      final_count="$(process_restart_count "${process_name}")"

      echo "PM2 ${process_name}: status=${status}, restarts=${final_count}"

      if [ "${status}" != "online" ] || \
         [ "${first_counts[${process_name}]}" != "${final_count}" ]; then
        failed=1
      fi
    fi
  done

  [ "${failed}" -eq 0 ]
}

rollback() {
  local exit_code=$?

  trap - ERR

  if [ "${DEPLOY_STARTED}" -ne 1 ]; then
    exit "${exit_code}"
  fi

  if [ "${ROLLBACK_RUNNING}" -eq 1 ]; then
    echo "Критическая ошибка во время автоматического отката."
    exit "${exit_code}"
  fi

  ROLLBACK_RUNNING=1

  echo
  echo "======================================================"
  echo "     ОШИБКА ДЕПЛОЯ — АВТОМАТИЧЕСКИЙ ОТКАТ"
  echo "======================================================"
  echo
  echo "Бэкап: ${REMOTE_BACKUP}"

  if [ ! -d "${REMOTE_BACKUP}" ]; then
    echo "Ошибка: каталог бэкапа не найден."
    exit "${exit_code}"
  fi

  rsync -a --delete \
    "${REMOTE_BACKUP}/" \
    "${REMOTE_DIR}/"

  cd "${REMOTE_DIR}"

  node -e "require('./package.json')"
  install_dependencies
  restart_existing_processes

  if check_existing_processes; then
    pm2 save
    echo "Автоматический откат выполнен успешно."
  else
    echo "Файлы восстановлены, но один из PM2-процессов не online."
  fi

  rm -rf "${REMOTE_STAGE}"
  rm -f "${REMOTE_ARCHIVE}"

  exit "${exit_code}"
}

trap rollback ERR

echo
echo "Проверка свободного места..."

mkdir -p "$(dirname "${REMOTE_BACKUP}")"

REQUIRED_KB="$(du -sk "${REMOTE_DIR}" | awk '{print $1}')"
AVAILABLE_KB="$(df -Pk "$(dirname "${REMOTE_BACKUP}")" | awk 'NR == 2 {print $4}')"
REQUIRED_WITH_RESERVE_KB="$((REQUIRED_KB * 2))"

echo "Размер текущего проекта: ${REQUIRED_KB} KB"
echo "Необходимый запас:       ${REQUIRED_WITH_RESERVE_KB} KB"
echo "Свободно:                ${AVAILABLE_KB} KB"

if [ "${AVAILABLE_KB}" -lt "${REQUIRED_WITH_RESERVE_KB}" ]; then
  echo "Ошибка: недостаточно места для безопасного бэкапа."
  exit 1
fi

echo
echo "Создание полного бэкапа..."

if [ -e "${REMOTE_BACKUP}" ]; then
  echo "Ошибка: путь бэкапа уже существует: ${REMOTE_BACKUP}"
  exit 1
fi

mkdir -p "${REMOTE_BACKUP}"
cp -a "${REMOTE_DIR}/." "${REMOTE_BACKUP}/"

if [ ! -f "${REMOTE_BACKUP}/package.json" ]; then
  echo "Ошибка: package.json не попал в бэкап."
  exit 1
fi

if [ -f "${REMOTE_DIR}/.env" ] && [ ! -f "${REMOTE_BACKUP}/.env" ]; then
  echo "Ошибка: существующий .env не попал в бэкап."
  exit 1
fi

echo "Бэкап создан: ${REMOTE_BACKUP}"

echo
echo "Подготовка временной версии..."

rm -rf "${REMOTE_STAGE}"
mkdir -p "${REMOTE_STAGE}"
tar -xzf "${REMOTE_ARCHIVE}" -C "${REMOTE_STAGE}"

STAGED_DIR="${REMOTE_STAGE}/${SOURCE_NAME}"

if [ ! -d "${STAGED_DIR}" ]; then
  echo "Ошибка: в архиве отсутствует папка ${SOURCE_NAME}."
  exit 1
fi

if [ ! -f "${STAGED_DIR}/package.json" ]; then
  echo "Ошибка: в архиве отсутствует package.json."
  exit 1
fi

cd "${STAGED_DIR}"
node -e "require('./package.json')"

while IFS= read -r -d '' file; do
  node --check "${file}"
done < <(
  find "${STAGED_DIR}" \
    -path "${STAGED_DIR}/node_modules" -prune -o \
    -path "${STAGED_DIR}/.git" -prune -o \
    -type f -name '*.js' -print0
)

echo "Временная версия проверена."

DEPLOY_STARTED=1

echo
echo "Синхронизация новой версии..."

rsync -a --delete \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='node_modules/' \
  --exclude='.git/' \
  --exclude='storage/' \
  --exclude='media-uploads/' \
  --exclude='media-upload/uploads/' \
  --exclude='logs/' \
  --exclude='backups/' \
  --exclude='tmp/' \
  --exclude='*.log' \
  "${STAGED_DIR}/" \
  "${REMOTE_DIR}/"

if [ ! -f "${REMOTE_DIR}/package.json" ]; then
  echo "Ошибка: после синхронизации отсутствует package.json."
  false
fi

if [ -f "${REMOTE_BACKUP}/.env" ] && [ ! -f "${REMOTE_DIR}/.env" ]; then
  echo "Ошибка: prod .env исчез."
  false
fi

cd "${REMOTE_DIR}"

echo
echo "Повторная проверка JavaScript..."

while IFS= read -r -d '' file; do
  node --check "${file}"
done < <(
  find "${REMOTE_DIR}" \
    -path "${REMOTE_DIR}/node_modules" -prune -o \
    -path "${REMOTE_DIR}/.git" -prune -o \
    -path "${REMOTE_DIR}/storage" -prune -o \
    -path "${REMOTE_DIR}/media-uploads" -prune -o \
    -path "${REMOTE_DIR}/media-upload/uploads" -prune -o \
    -type f -name '*.js' -print0
)

echo
echo "Установка зависимостей..."
install_dependencies

echo
echo "Перезапуск процессов..."
restart_existing_processes

echo
echo "Проверка PM2-процессов..."
check_existing_processes

echo
echo "Проверка стабильности PM2..."
check_process_stability

pm2 save

DEPLOY_STARTED=0

rm -rf "${REMOTE_STAGE}"
rm -f "${REMOTE_ARCHIVE}"

echo
echo "Установка kotocats-core завершена успешно."

REMOTE_SCRIPT

echo
echo "[6/7] Сравнение версии на test и prod..."

LOCAL_HASH="$(
  cd "${SOURCE_DIR}"
  find . -type f \
    ! -path './.git/*' \
    ! -path './node_modules/*' \
    ! -path './storage/*' \
    ! -path './media-uploads/*' \
    ! -path './media-upload/uploads/*' \
    ! -path './logs/*' \
    ! -path './backups/*' \
    ! -path './tmp/*' \
    ! -name '.env' \
    ! -name '.env.*' \
    ! -name '*.log' \
    ! -name 'deploy-prod.sh' \
    -print0 |
    sort -z |
    xargs -0 sha256sum |
    sha256sum |
    awk '{print $1}'
)"

REMOTE_HASH="$(
  ssh "${REMOTE_HOST}" bash -s -- "${REMOTE_DIR}" <<'REMOTE_HASH_SCRIPT'
set -Eeuo pipefail

REMOTE_DIR="$1"
cd "${REMOTE_DIR}"

find . -type f \
  ! -path './.git/*' \
  ! -path './node_modules/*' \
  ! -path './storage/*' \
  ! -path './media-uploads/*' \
  ! -path './media-upload/uploads/*' \
  ! -path './logs/*' \
  ! -path './backups/*' \
  ! -path './tmp/*' \
  ! -name '.env' \
  ! -name '.env.*' \
  ! -name '*.log' \
  -print0 | \
  sort -z | \
  xargs -0 sha256sum | \
  sha256sum | \
  awk '{print $1}'
REMOTE_HASH_SCRIPT
)"

echo "Test: ${LOCAL_HASH}"
echo "Prod: ${REMOTE_HASH}"

if [ "${LOCAL_HASH}" != "${REMOTE_HASH}" ]; then
  echo "Ошибка: полные хэши версии не совпали."
  echo "Prod уже установлен, но набор файлов отличается."
  exit 1
fi

echo "Версии test и prod идентичны."

echo
echo "[7/7] Финальная проверка..."

ssh "${REMOTE_HOST}" "
  set -e

  export NVM_DIR=\"\$HOME/.nvm\"
  if [ -s \"\$NVM_DIR/nvm.sh\" ]; then
    . \"\$NVM_DIR/nvm.sh\"
  fi

  echo
  echo 'Node:'
  node -v

  echo
  echo 'npm:'
  npm -v

  echo
  echo 'Папка kotocats-core:'
  ls -ld '${REMOTE_DIR}'

  echo
  echo 'Основные файлы:'
  ls -la '${REMOTE_DIR}/package.json'
  [ ! -f '${REMOTE_DIR}/package-lock.json' ] || ls -la '${REMOTE_DIR}/package-lock.json'

  if [ -f '${REMOTE_DIR}/.env' ]; then
    echo
    echo 'Prod .env на месте:'
    ls -la '${REMOTE_DIR}/.env'
  fi

  echo
  echo 'PM2:'
  pm2 status

  echo
  echo 'Последние логи core:'
  pm2 logs core --lines 50 --nostream

  echo
  echo 'Последние ошибки PM2:'
  pm2 logs --err --lines 30 --nostream
"

echo
echo "======================================================"
echo "       KOTOCATS-CORE УСПЕШНО РАЗВЁРНУТ"
echo "======================================================"
echo
echo "Бэкап prod:"
echo "${REMOTE_BACKUP}"
echo

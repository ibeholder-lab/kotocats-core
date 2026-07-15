#!/usr/bin/env bash

set -Eeuo pipefail

SOURCE_DIR="/opt/kotocats-core"
REMOTE_HOST="kotobot-prod"
REMOTE_DIR="/opt/kotocats-core"

PROJECT_NAME="kotocats-core"

# Приложения, использующие kotocats-core.
PM2_PROCESSES=("site" "cafe" "bot")

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

LOCAL_ARCHIVE="/tmp/${PROJECT_NAME}-${TIMESTAMP}.tar.gz"
REMOTE_ARCHIVE="/tmp/${PROJECT_NAME}-${TIMESTAMP}.tar.gz"
REMOTE_STAGE="/tmp/${PROJECT_NAME}-stage-${TIMESTAMP}"
REMOTE_BACKUP="/opt/backups/${PROJECT_NAME}-${TIMESTAMP}"

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
echo "Папка проекта удаляться не будет."
echo "Продовый .env переноситься или заменяться не будет."
echo "При ошибке будет выполнен автоматический откат."
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
echo "[1/7] Проверка проекта на тесте..."

if [ ! -d "${SOURCE_DIR}" ]; then
  echo "Ошибка: папка ${SOURCE_DIR} не найдена."
  exit 1
fi

if [ ! -f "${SOURCE_DIR}/package.json" ]; then
  echo "Ошибка: файл ${SOURCE_DIR}/package.json не найден."
  exit 1
fi

cd "${SOURCE_DIR}"

node -e "
  const pkg = require('./package.json');
  console.log('Пакет:', pkg.name || 'без имени');
  console.log('Версия:', pkg.version || 'не указана');
"

echo
echo "Проверка синтаксиса JavaScript-файлов..."

while IFS= read -r -d '' FILE; do
  node --check "${FILE}"
done < <(
  find "${SOURCE_DIR}" \
    -path "${SOURCE_DIR}/node_modules" -prune -o \
    -path "${SOURCE_DIR}/.git" -prune -o \
    -type f -name "*.js" -print0
)

echo "Локальная версия проверена."

echo
echo "[2/7] Проверка подключения к проду..."

ssh "${REMOTE_HOST}" "
  command -v node >/dev/null 2>&1 || {
    echo 'Ошибка: на проде не найден node.'
    exit 1
  }

  command -v npm >/dev/null 2>&1 || {
    echo 'Ошибка: на проде не найден npm.'
    exit 1
  }

  command -v pm2 >/dev/null 2>&1 || {
    echo 'Ошибка: на проде не найден pm2.'
    exit 1
  }

  test -d '${REMOTE_DIR}' || {
    echo 'Ошибка: папка ${REMOTE_DIR} на проде не найдена.'
    exit 1
  }

  test -f '${REMOTE_DIR}/package.json' || {
    echo 'Ошибка: на проде отсутствует ${REMOTE_DIR}/package.json.'
    exit 1
  }

  mkdir -p /opt/backups
"

echo "Прод доступен."

echo
echo "[3/7] Создание архива..."

rm -f "${LOCAL_ARCHIVE}"

tar \
  --exclude='kotocats-core/.env' \
  --exclude='kotocats-core/.env.*' \
  --exclude='kotocats-core/node_modules' \
  --exclude='kotocats-core/.git' \
  --exclude='kotocats-core/logs' \
  --exclude='kotocats-core/backups' \
  --exclude='kotocats-core/tmp' \
  --exclude='kotocats-core/*.log' \
  --exclude='kotocats-core/deploy-prod.sh' \
  -czf "${LOCAL_ARCHIVE}" \
  -C /opt \
  kotocats-core

echo "Архив создан:"
ls -lh "${LOCAL_ARCHIVE}"

echo
echo "[4/7] Копирование архива на прод..."

scp "${LOCAL_ARCHIVE}" "${REMOTE_HOST}:${REMOTE_ARCHIVE}"

echo
echo "[5/7] Установка с резервным копированием и автооткатом..."

ssh "${REMOTE_HOST}" bash -s -- \
  "${REMOTE_DIR}" \
  "${REMOTE_ARCHIVE}" \
  "${REMOTE_STAGE}" \
  "${REMOTE_BACKUP}" \
  "${PROJECT_NAME}" \
  "${PM2_PROCESSES[@]}" <<'REMOTE_SCRIPT'

set -Eeuo pipefail

REMOTE_DIR="$1"
REMOTE_ARCHIVE="$2"
REMOTE_STAGE="$3"
REMOTE_BACKUP="$4"
PROJECT_NAME="$5"

shift 5
PM2_PROCESSES=("$@")

DEPLOY_STARTED=0
ROLLBACK_RUNNING=0

process_exists() {
  local process_name="$1"

  pm2 jlist |
    node -e '
      let input = "";

      process.stdin.on("data", chunk => {
        input += chunk;
      });

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

      process.stdin.on("data", chunk => {
        input += chunk;
      });

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
    sleep 4
  fi
}

check_existing_processes() {
  local failed=0

  for process_name in "${PM2_PROCESSES[@]}"; do
    if process_exists "${process_name}"; then
      status="$(process_status "${process_name}")"

      echo "PM2 ${process_name}: ${status}"

      if [ "${status}" != "online" ]; then
        failed=1
      fi
    fi
  done

  if [ "${failed}" -ne 0 ]; then
    return 1
  fi
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
  echo "Бэкап:"
  echo "${REMOTE_BACKUP}"

  if [ ! -d "${REMOTE_BACKUP}" ]; then
    echo "Ошибка: каталог бэкапа не найден."
    exit "${exit_code}"
  fi

  # Важно: папка проекта не удаляется.
  # Старые файлы накладываются поверх текущих.
  cp -a "${REMOTE_BACKUP}/." "${REMOTE_DIR}/"

  cd "${REMOTE_DIR}"

  node -e "require('./package.json')"

  if [ -f package-lock.json ]; then
    npm ci --omit=dev
  else
    npm install --omit=dev
  fi

  restart_existing_processes

  if check_existing_processes; then
    pm2 save

    echo
    echo "Автоматический откат выполнен успешно."
  else
    echo
    echo "Файлы восстановлены, но один из PM2-процессов не online."
  fi

  rm -rf "${REMOTE_STAGE}"
  rm -f "${REMOTE_ARCHIVE}"

  exit "${exit_code}"
}

trap rollback ERR

echo
echo "Создание полного бэкапа..."

mkdir -p "${REMOTE_BACKUP}"

# Точка после REMOTE_DIR обязательна:
# она копирует также скрытые файлы, включая .env.
cp -a "${REMOTE_DIR}/." "${REMOTE_BACKUP}/"

if [ ! -f "${REMOTE_BACKUP}/package.json" ]; then
  echo "Ошибка: package.json не попал в бэкап."
  exit 1
fi

if [ -f "${REMOTE_DIR}/.env" ] && [ ! -f "${REMOTE_BACKUP}/.env" ]; then
  echo "Ошибка: существующий .env не попал в бэкап."
  exit 1
fi

echo "Бэкап создан:"
echo "${REMOTE_BACKUP}"

echo
echo "Подготовка временной версии..."

rm -rf "${REMOTE_STAGE}"
mkdir -p "${REMOTE_STAGE}"

tar -xzf "${REMOTE_ARCHIVE}" -C "${REMOTE_STAGE}"

STAGED_DIR="${REMOTE_STAGE}/${PROJECT_NAME}"

if [ ! -d "${STAGED_DIR}" ]; then
  echo "Ошибка: в архиве отсутствует папка ${PROJECT_NAME}."
  exit 1
fi

if [ ! -f "${STAGED_DIR}/package.json" ]; then
  echo "Ошибка: в архиве отсутствует package.json."
  exit 1
fi

cd "${STAGED_DIR}"

node -e "
  const pkg = require('./package.json');
  console.log('Проверен пакет:', pkg.name || 'без имени');
"

while IFS= read -r -d '' file; do
  node --check "${file}"
done < <(
  find "${STAGED_DIR}" \
    -path "${STAGED_DIR}/node_modules" -prune -o \
    -path "${STAGED_DIR}/.git" -prune -o \
    -type f -name "*.js" -print0
)

echo "Временная версия проверена."

DEPLOY_STARTED=1

echo
echo "Копирование новой версии поверх существующей..."

# Никакого --delete.
# Никакого удаления REMOTE_DIR.
# Продовые .env, node_modules и служебные папки не затрагиваются.
rsync -a \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='node_modules/' \
  --exclude='.git/' \
  --exclude='logs/' \
  --exclude='backups/' \
  --exclude='tmp/' \
  "${STAGED_DIR}/" \
  "${REMOTE_DIR}/"

if [ ! -f "${REMOTE_DIR}/package.json" ]; then
  echo "Ошибка: после копирования отсутствует package.json."
  false
fi

if [ -f "${REMOTE_BACKUP}/.env" ] && [ ! -f "${REMOTE_DIR}/.env" ]; then
  echo "Ошибка: продовый .env исчез."
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
    -type f -name "*.js" -print0
)

echo
echo "Установка зависимостей..."

if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

echo
echo "Перезапуск приложений, использующих kotocats-core..."

restart_existing_processes

echo
echo "Проверка PM2-процессов..."

check_existing_processes

pm2 save

DEPLOY_STARTED=0

rm -rf "${REMOTE_STAGE}"
rm -f "${REMOTE_ARCHIVE}"

echo
echo "Установка kotocats-core завершена успешно."

REMOTE_SCRIPT

echo
echo "[6/7] Сравнение основных файлов..."

LOCAL_PACKAGE_HASH="$(
  sha256sum "${SOURCE_DIR}/package.json" |
    awk '{print $1}'
)"

REMOTE_PACKAGE_HASH="$(
  ssh "${REMOTE_HOST}" \
    "sha256sum '${REMOTE_DIR}/package.json' | awk '{print \$1}'"
)"

echo "package.json на тесте: ${LOCAL_PACKAGE_HASH}"
echo "package.json на проде: ${REMOTE_PACKAGE_HASH}"

if [ "${LOCAL_PACKAGE_HASH}" != "${REMOTE_PACKAGE_HASH}" ]; then
  echo "Ошибка: package.json на тесте и проде различается."
  exit 1
fi

echo "package.json совпадает."

echo
echo "[7/7] Финальная проверка..."

ssh "${REMOTE_HOST}" "
  echo
  echo 'Папка kotocats-core:'
  ls -ld '${REMOTE_DIR}'

  echo
  echo 'Основные файлы:'
  ls -la \
    '${REMOTE_DIR}/package.json' \
    '${REMOTE_DIR}/package-lock.json' 2>/dev/null || true

  if [ -f '${REMOTE_DIR}/.env' ]; then
    echo
    echo 'Продовый .env на месте:'
    ls -la '${REMOTE_DIR}/.env'
  else
    echo
    echo 'В проекте нет .env — это допустимо, если core его не использует.'
  fi

  echo
  echo 'PM2:'
  pm2 status

  echo
  echo 'Последние ошибки PM2:'
  pm2 logs --err --lines 30 --nostream
"

echo
echo "======================================================"
echo "       KOTOCATS-CORE УСПЕШНО РАЗВЁРНУТ"
echo "======================================================"
echo
echo "Бэкап прода:"
echo "${REMOTE_BACKUP}"
echo

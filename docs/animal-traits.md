# Атрибуты характера животных

Структура и начальные данные разворачиваются только через Directus API:

```bash
cd /opt/kotocats-core
npm run traits:bootstrap
```

Команда безопасна для повторного запуска: она создаёт отсутствующие коллекции, поля и связи, а seed добавляет только отсутствующие `slug`. Существующие записи не обновляются и не удаляются.

Создаются `animal_traits`, junction `animals_animal_traits` и M2M-поле `animals.traits`. Скрытый `pair_key` имеет уникальное ограничение Directus и формируется сервисом как `animal_id:trait_id`, чтобы пара не могла дублироваться. Обе внешние связи используют `ON DELETE CASCADE`.

Перед применением на тестовом сервере сохранить полный snapshot:

```bash
mkdir -p /opt/kotocats-core/.backups
docker exec kotobot_directus npx directus schema snapshot /tmp/directus-before-animal-traits.yaml
docker cp kotobot_directus:/tmp/directus-before-animal-traits.yaml /opt/kotocats-core/.backups/
```

Публичные Directus permissions не расширяются. Фонд и кафе читают данные серверным токеном через `kotocats-core`, а бот меняет связи через защищённые `/api/internal/animals/:id/traits` с `KOTOCATS_CORE_INTERNAL_TOKEN`.

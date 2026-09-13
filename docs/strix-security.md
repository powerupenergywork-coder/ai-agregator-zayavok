# Пентест сервиса через Strix

[Strix](https://github.com/usestrix/strix) — open-source ИИ-пентестер: агенты
сами атакуют цель и подтверждают находки рабочим эксплойтом. У нас он на каждый
pull request проверяет **тестовый стенд** KerekTap как чёрный ящик.

## Главное правило

Strix **реально атакует** цель. Гонять его можно **только против стенда** — не
против прода. На проде живое подключение к WhatsApp (Meta), настоящие телефоны
исполнителей и клиентов, боевая база: активная атака там означает разосланные
сообщения, испорченные данные и риск бана номера.

CI-стенд безопасен, потому что там всё внешнее замокано —
`WHATSAPP_PROVIDER=console`, `AI_PROVIDER=mock`, `PAYMENT_PROVIDER=mock`,
`SMS_PROVIDER=console`, — отдельная пустая база, и прод из CI недоступен.

## Как это работает в CI

Workflow — [`.github/workflows/strix.yml`](../.github/workflows/strix.yml). На
каждый PR:

1. Поднимает Postgres и Redis (сервисы job), накатывает миграции.
2. Запускает API (`:3001`) и веб (`:3100`) с безопасными провайдерами.
3. Ставит Strix и гонит `quick`-скан против обоих адресов, указывая на
   [`ops/strix/instructions.md`](../ops/strix/instructions.md) — где искать в
   первую очередь и чего не трогать.
4. Кладёт отчёт (`strix_runs/`) в артефакт `strix-report`.
5. Падает, если найдены уязвимости (код выхода 2).

Цель Strix — реальный IP хоста раннера (`hostname -I`), а не `localhost`: из
Docker-песочницы Strix `localhost` — это она сама, а `host.docker.internal` на
Linux не резолвится.

## Что нужно настроить один раз

**Settings → Secrets and variables → Actions → Secrets:**

| Секрет | Значение |
|--------|----------|
| `LLM_API_KEY` | ключ провайдера модели (например OpenAI) |
| `STRIX_LLM` | имя модели, например `openai/gpt-5.4` |

Модель — любая из [поддерживаемых](https://docs.strix.ai/llm-providers/overview).
Без этих секретов job не падает, а помечается пропущенным: PR не краснеет, но и
не проверяется.

**Переменные (Variables), необязательно:**

| Переменная | По умолчанию | Смысл |
|------------|--------------|-------|
| `STRIX_FAIL_ON_FINDINGS` | `true` | `false` — собирать отчёт, но не блокировать мерж (на время обкатки) |
| `STRIX_ENABLED` | `true` | `false` — выключить авто-прогон на PR (ручной `workflow_dispatch` останется) |

Бюджет и режим правятся в `env` вверху workflow: `STRIX_MAX_BUDGET` (потолок
трат на модель за прогон, USD) и `STRIX_SCAN_MODE`.

## Сколько это стоит и длится

`quick` — минуты и небольшой расход модели, поэтому и выбран для каждого PR.
Потолок трат ограничен `STRIX_MAX_BUDGET` ($3 по умолчанию): дойдя до него,
Strix останавливается. Режимы `standard` (30–60 мин) и `deep` (1–4 ч) — для
ручных полных аудитов, не для каждого PR.

## Прогнать локально

Нужен Docker и ключ модели. Стенд уже должен быть поднят
(`docker compose up -d`, `npm run dev:api`, веб на `:3100`).

```bash
curl -sSL https://strix.ai/install | bash          # разово

export STRIX_LLM="openai/gpt-5.4"
export LLM_API_KEY="…"                              # не коммить

# host.docker.internal работает в Docker Desktop (Windows/macOS);
# на Linux подставьте IP хоста из `hostname -I`.
strix -t http://host.docker.internal:3001 \
      -t http://host.docker.internal:3100 \
      --scan-mode quick \
      --instruction-file ops/strix/instructions.md

strix view      # отчёт в локальном дашборде
```

Полный аудит перед крупным релизом — тот же запуск с `--scan-mode deep` и
большим `--max-budget`.

## Ограничения

- Strix проверяет ключ модели **до** запуска песочницы — с неверным ключом
  падает на 401, ничего не запуская.
- Доступ песочницы к стенду на Linux-раннере — через IP хоста; если однажды
  GitHub изменит сеть раннеров, шаг «Стенд готов» это поймает и job упадёт
  понятной ошибкой, а не молча пропустит проверку.

# Manager Service

Backend-сервис с управлением через Telegram-бота: отслеживание активности в Jira/GitHub, автогенерация ежедневных/еженедельных/ежемесячных PDF-отчётов по сотрудникам (с AI-анализом через Claude API) и мероприятия/напоминания.

## Стек

- Node.js 20 + TypeScript
- grammY (Telegram Bot API) + `@grammyjs/conversations` для пошаговых диалогов настройки
- PostgreSQL + Prisma ORM
- Redis + BullMQ — минутный тик-планировщик отчётов и напоминаний
- Anthropic Claude API (`claude-haiku-4-5-20251001`) — анализ активности и текстовые блоки отчёта
- jira.js, `@octokit/rest` — интеграции с Jira Cloud и GitHub
- pdfkit — генерация PDF-отчётов (таблицы + векторные диаграммы, без нативных зависимостей)
- Файлы (загруженная документация, готовые отчёты) хранятся на файловой системе сервиса (`storage/`)

## Локальный запуск

```bash
cd service
cp .env.example .env   # заполнить токены и ключи
npm install
npx prisma migrate dev --name init
npm run dev
```

Требуются локально запущенные PostgreSQL и Redis (см. `docker-compose.yml` — можно поднять только зависимости: `docker compose up postgres redis`).

## Основные команды бота

| Команда | Кто | Назначение |
|---|---|---|
| `/newcompany` | супер-админ (id из `TELEGRAM_SUPER_ADMIN_IDS`) | создать компанию, создатель становится её админом |
| `/selectcompany <id>` | админ компании | выбрать активную компанию, если их несколько |
| `/addadmin` | админ компании | добавить ещё одного администратора |
| `/addemployee` | админ компании | добавить сотрудника (username, ФИО, отдел, должность, GitHub-логин) |
| `/listemployees` | админ компании | список сотрудников со статусом привязки к Jira/GitHub |
| `/mapidentity` | админ компании | явно сопоставить сотрудника с его аккаунтом в Jira (поиск по имени/email или ввод accountId) и/или GitHub username — на случай, если в этих системах у сотрудника другое отображаемое имя |
| `/setjira` / `/setgithub` | админ компании | привязать Jira/GitHub организацию (токены шифруются AES-256-GCM) |
| `/addproject` / `/adddirection` | админ компании | создать проект и направления внутри него |
| `/linkdirection` | админ компании | привязать к направлению сотрудников, GitHub-репозиторий, Jira-проект/доски, документацию (.txt/.docx или ссылка) |
| `/setreportconfig` | админ компании | расписание daily/weekly/monthly отчётов (время, день недели/дней до конца месяца) |
| `/setapprovals` | админ компании | сколько одобрений админов нужно для пересылки отчёта в группу |
| `/setgroupchat` | админ компании (внутри группы) | привязать текущий групповой чат |
| `/addoccasion` | админ компании | одноразовое или повторяющееся мероприятие/напоминание |
| `/report daily\|weekly\|monthly` | админ компании | сгенерировать отчёт вне расписания |

## Архитектура отчёта

1. Планировщик (`src/scheduler`) раз в минуту сверяет текущее время в таймзоне компании с `ReportSchedule`/`Occasion`.
2. При срабатывании — `src/reports/generator.ts` тянет из Jira задачи направления за период (с историей статусов) и коммиты GitHub, сопоставляет коммиты с задачами по ключу issue, считает метрики (`src/reports/metrics.ts`), прогоняет через Claude API текстовое резюме по каждому сотруднику с учётом документации направления.
3. `src/reports/pdf.ts` рендерит PDF (таблицы + барчарт/donut без нативных canvas-зависимостей).
4. Отчёт рассылается всем админам компании с inline-кнопкой одобрения; при достижении нужного числа одобрений (`Company.requiredApprovals`) пересылается в `groupChatId`.

---

# Роадмап деплоя на VDS (Ubuntu)

## 1. Подготовка сервера

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # перелогиниться после этого
sudo apt install -y docker-compose-plugin git
```

## 2. Клонирование репозитория на сервер

```bash
git clone <your-repo-url> /opt/manager
cd /opt/manager
cp .env.example .env
nano .env   # заполнить TELEGRAM_BOT_TOKEN, TELEGRAM_SUPER_ADMIN_IDS, ANTHROPIC_API_KEY,
            # ENCRYPTION_KEY (32-байтный hex: `openssl rand -hex 32`), POSTGRES_PASSWORD и т.д.
```

`docker-compose.prod.yml` ожидает `.env` рядом с собой и переменную `GITHUB_REPOSITORY` (owner/repo) для образа из GHCR.

## 3. Первый запуск

```bash
export GITHUB_REPOSITORY=<owner>/<repo>
docker compose -f docker-compose.prod.yml --env-file .env pull
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml logs -f app
```

При старте контейнер `app` сам выполняет `prisma migrate deploy` перед запуском Node-процесса.

## 4. Настройка GitHub Actions (CI/CD на `main`)

Workflow уже в репозитории: `.github/workflows/deploy.yml`.

Шаги:
1. На вкладке **Settings → Secrets and variables → Actions** репозитория добавить:
   - `VDS_HOST` — IP/домен сервера
   - `VDS_USER` — ssh-пользователь (например, `deploy`)
   - `VDS_SSH_KEY` — приватный ключ (публичный добавить в `~/.ssh/authorized_keys` на сервере)
   - `VDS_SSH_PASSPHRASE` — passphrase от приватного ключа, если он защищён паролем (workflow передаёт его в `appleboy/ssh-action` полем `passphrase`, ключ расшифровывается неинтерактивно на лету). Если ключ без passphrase — секрет не создавать, `appleboy/ssh-action` спокойно работает с пустым значением.
   - `VDS_DEPLOY_PATH` — путь к репозиторию на сервере (корень git-клона, например `/opt/manager`)
2. `GITHUB_TOKEN` для входа в GHCR передаётся автоматически, дополнительно настраивать не нужно.
3. Убедиться, что пакет образа (`ghcr.io/<owner>/<repo>`) публичный либо что сервер выполняет `docker login ghcr.io` (workflow делает это самостоятельно перед `pull`).
4. При пуше в `main`: job `build` собирает и типизирует проект, пушит Docker-образ в GHCR с тегами `latest` и `<sha>`; job `deploy` по SSH заходит на VDS, обновляет репозиторий (`git pull`) и перезапускает `docker compose` с новым образом.

## 5. Резервное копирование

- `postgres_data` — volume с БД компаний/отчётов/сотрудников. Регулярный `pg_dump` через cron на хосте:
  ```bash
  docker exec <postgres_container> pg_dump -U manager manager | gzip > /opt/backups/manager_$(date +%F).sql.gz
  ```
- `app_storage` — volume с загруженной документацией и сгенерированными PDF-отчётами; бэкапить `tar`/`rsync` по расписанию.

## 6. Наблюдение и обслуживание

- Логи: `docker compose -f docker-compose.prod.yml logs -f app`
- Обновление секретов (токены Jira/GitHub на уровне компании) выполняется через бота (`/setjira`, `/setgithub`) — они шифруются `ENCRYPTION_KEY` перед записью в БД; при смене `ENCRYPTION_KEY` ранее сохранённые токены нужно ввести заново.
- Масштабирование: BullMQ-воркер и сам бот сейчас работают в одном процессе (`src/index.ts`); при росте нагрузки можно вынести `startScheduler()` в отдельный контейнер/процесс, использующий тот же Redis/Postgres.

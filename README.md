# ExamFlow

ExamFlow is a database-driven English examination platform for students,
content administrators, and super administrators. It includes a Next.js web
app, an async FastAPI API, PostgreSQL, Redis, a Celery import worker, and an
aiogram Telegram bot.

## Quick start

1. Copy `.env.example` to `.env`.
2. Add your Telegram bot token and username if the bot is needed.
3. Run `docker compose up --build`.
4. Open `http://localhost:13000`.
5. API documentation is available at `http://localhost:18000/docs`.

On Windows, you can instead run
`launcher\Windows Run\Clean Rebuild.bat`. It prepares `.env`, starts Docker
Desktop when needed, rebuilds every service from a clean cache, and opens the
web application. Use `Stop ExamFlow.bat` to stop it; the database is preserved
across both.

The first startup applies the database migration and seeds infrastructure
rows. Super admin credentials come from `ADMIN_PHONE` and `ADMIN_PASSWORD` in
your private `.env` file. Change all example credentials before deployment.

## Repository map

```text
backend/                 FastAPI application, domain models and import pipeline
  app/api/v1/            Versioned HTTP endpoints
  app/core/              Configuration, database and security
  app/models/            SQLAlchemy domain model
  app/schemas/           Validated API contracts
  app/services/          Grading, audit and domain services
  app/importer/          Archive-to-interactive-test import stages
  alembic/               Database migrations
  seed/                  Admin, levels, and exam-type bootstrap
bot/                     Telegram linking and contact verification process
frontend/                Next.js App Router application
launcher/Windows Run/    Windows launcher
resources/source-archive/
  Beginner/              Beginner Mid/End tests and media
  Elementary/            Elementary Mid/End tests and media
  Intermediate/          Intermediate Mid/End tests and media
  Pre-Intermediate/      Pre-Intermediate Mid/End tests and media
```

## Local development

Backend:

```bash
cd backend
python -m venv .venv
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Telegram setup

Create a bot with BotFather, put its token and username in `.env`, and start
the bot service. Account linking uses Telegram's native contact-share button.
The shared number must match the student's normalized `+998` number; typed
numbers are never trusted for linking.

## Content workflow

The repository is configured to synchronize the supplied Road Map archive.
Administrators can edit every imported task, question, answer, and setting.
Additional ZIP/RAR packages can be reviewed through the import screen. Imports
are extracted with depth and size limits, converted from legacy DOC when
needed, parsed into candidates, linked to answer keys, and assigned confidence
scores. Every import remains `NEEDS_REVIEW` until an administrator reviews and
publishes it. Unclassified content is retained as `rich_text_question`.

## Import the supplied Road Map package

After the containers are running:

```bash
docker compose run --rm backend python -m app.importer.roadmap_import
```

The initial import creates 26 variants and copies 49 audio/video assets from
`resources/source-archive`. To safely refresh parser metadata and add newly
split questions without deleting attempts, run:

```bash
docker compose exec backend python -m seed.enrich_interactions
```

## Production notes

- Replace all default secrets and seed credentials.
- Set `COOKIE_SECURE=true` behind HTTPS.
- Use object storage by configuring `STORAGE_ENDPOINT` and credentials.
- Run multiple API and worker instances as required.
- Configure a reverse proxy to route `/api` to the backend.

## Assumptions

- The final v2 specification supersedes the earlier draft.
- The product name is **ExamFlow**.
- Passwords require at least eight characters, one letter, and one number.
- The seed uses wholly original sample content.

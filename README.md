# ExamFlow — English Exam Platform

> O'quv markazlar uchun ingliz tili imtihon platformasi. O'quvchilar onlayn test topshiradi, o'qituvchilar natijalarni real vaqtda kuzatadi.

**Live demo:** [rgn-exam.uz](https://rgn-exam.uz)

<!-- lokal -> GitHub -> server zanjiri sinovi -->

---

## Loyiha haqida

ExamFlow — bu o'quv markazlar uchun maxsus qurilgan imtihon tizimi. Word hujjatlaridan testlar import qilinadi, AI yordamida baholanadi va o'quvchilar Telegram orqali ulanib, onlayn topshiradi. Admin panel orqali barcha jarayon boshqariladi.

## Imkoniyatlar

**O'quvchi uchun**
- Daraja bo'yicha testlar: Beginner → Elementary → Pre-Intermediate → Intermediate
- Mid-course va End-course imtihonlari
- Har bir savol turini qo'llab-quvvatlash: ko'p tanlovli, gap to'ldirish, audio topshiriqlar, idiom matching
- Natijalar tarixi va statistika
- Saqlab qo'yilgan savollar
- O'qituvchi baholash panel

**Admin uchun**
- Word (.docx) fayllardan test import qilish
- Import pipeline: ZIP/RAR arxiv → DOC konvertatsiya → parsing → confidence score → NEEDS_REVIEW
- AI grading (ai_grading service)
- Testlarni tahrirlash, variant yaratish, nashr qilish
- Barcha o'quvchilar, urinishlar va audit log ko'rish
- Alembic migratsiyalar

**Telegram bot**
- O'quvchi akkauntini Telegram orqali ulash
- Kontakt orqali raqam tekshiruvi (typed number ishonilmaydi)

## Tech Stack

**Backend**
- Python · FastAPI (async)
- PostgreSQL · SQLAlchemy · Alembic
- Redis · Celery (import worker)
- JWT autentifikatsiya

**Frontend**
- Next.js 15 (App Router)
- React 19 · TypeScript
- Tailwind CSS · shadcn/ui

**Bot**
- Python · aiogram 3

**Infra**
- Docker · Docker Compose
- Nginx (reverse proxy)
- Cloudflare Tunnel

## Loyiha tuzilmasi

```
examflow/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # auth, catalog, attempts, admin
│   │   ├── core/            # config, database, security, deps
│   │   ├── models/          # SQLAlchemy domain models
│   │   ├── schemas/         # Pydantic API contracts
│   │   └── services/        # grading, audit, AI, docx import, telegram
│   ├── alembic/             # DB migratsiyalar
│   ├── seed/                # Bootstrap: admin, levellar, exam turlari
│   ├── scripts/             # mass import, dedupe, backup, readiness report
│   ├── tests/               # pytest
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   ├── (auth)/          # sign-in, create-account, forgot-password
│   │   ├── (student)/       # dashboard, exam, saved, settings
│   │   ├── (admin)/         # admin panel, test builder, submissions
│   │   └── (exam)/          # exam runner
│   ├── components/
│   │   ├── exam/            # ExamRunner, AudioPlayer
│   │   ├── admin/           # TestBuilder, ExerciseBuilder, QuestionEditor
│   │   └── dashboard/       # LevelCard, StatCard
│   └── lib/                 # api.ts, types.ts, question-types.ts
├── bot/
│   └── main.py              # aiogram Telegram bot
├── launcher/Windows Run/    # Windows uchun .bat launcher
├── docker-compose.yml
└── docker-compose.prod.yml
```

## API endpointlar

```
Auth
  POST   /api/v1/auth/register
  POST   /api/v1/auth/login
  GET    /api/v1/auth/me

Catalog
  GET    /api/v1/catalog/levels
  GET    /api/v1/catalog/levels/{level}/exam-types
  GET    /api/v1/catalog/variants/{variantId}

Attempts
  POST   /api/v1/attempts
  GET    /api/v1/attempts/{attemptId}
  PATCH  /api/v1/attempts/{attemptId}
  GET    /api/v1/attempts/me

Admin
  GET    /api/v1/admin/students
  GET    /api/v1/admin/submissions
  GET    /api/v1/admin/audit-log
  POST   /api/v1/admin/import
  PATCH  /api/v1/admin/variants/{id}
```

## Local ishga tushirish

### Docker (eng oson)

```bash
git clone https://github.com/dil5hodbek/examflow.git
cd examflow
cp .env.example .env
# .env ichida TELEGRAM_BOT_TOKEN ni to'ldiring (ixtiyoriy)
docker compose up --build
```

Frontend: http://localhost:13000  
Backend API: http://localhost:18000/docs  
Admin login:  dagi  va 

### Windows launcher

```bat
launcher\Windows Run\Clean Rebuild.bat
```

Docker Desktop avtomatik ishga tushadi, build qiladi va brauzer ochadi.

### Qo'lda (development)

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 18000

# Frontend (yangi terminal)
cd frontend
npm install
npm run dev
```

## Content import

Testlar Word hujjatlaridan import qilinadi:

```bash
# Road Map arxivini import qilish
docker compose run --rm backend python -m app.importer.roadmap_import

# Metadata yangilash (attempt'larni o'chirmasdan)
docker compose exec backend python -m seed.enrich_interactions
```

Import pipeline bosqichlari:
1. ZIP/RAR arxiv ochiladi (hajm va chuqurlik limiti bilan)
2. Eski DOC format DOCX ga o'tkaziladi
3. Savollar, variantlar va javob kalitlari parse qilinadi
4. Har bir savol uchun confidence score hisoblanadi
5.  statusida qoladi — admin ko'rib nashr qiladi

## Testlar

```bash
cd backend
pytest tests/
```

Test qamrovi: question classifier, docx import, grading logic, Telegram linking, question templates.

## Production deploy

```bash
# Secretlarni almashtiring
cp .env.example .env
# SECRET_KEY, DB kredensiallar, TELEGRAM_BOT_TOKEN, SMTP sozlang

# HTTPS sozlangan bo'lsa
COOKIE_SECURE=true

docker compose -f docker-compose.prod.yml up --build -d
```

## Xavfsizlik

- JWT (HttpOnly cookie + Bearer token)
- Telegram linking: faqat native contact-share, typed number ishonilmaydi
- Rate limiting asosiy endpointlarda
- Upload: hajm va tip tekshiruvi
- Audit log: barcha admin harakatlar qayd etiladi

---

Muallif: [dil5hodbek](https://github.com/dil5hodbek)

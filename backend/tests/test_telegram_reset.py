import uuid

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.models import Attempt, AttemptAnswer, ExamType, Level, Question, Role, Section, Task, TestVariant, User


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "test-reset-secret")
    return {"X-Bot-Secret": "test-reset-secret"}


async def register(client, secret, phone):
    identity = {"chat_id": str(uuid.uuid4()), "telegram_user_id": str(uuid.uuid4())}
    await client.post("/api/v1/auth/telegram/bot-contact", json={**identity, "phone": phone}, headers=secret)
    response = await client.post("/api/v1/auth/telegram/bot-register",
                                 json={**identity, "first_name": "Test"}, headers=secret)
    assert response.status_code == 201
    return identity


async def prepare(client, secret, identity):
    response = await client.post("/api/v1/auth/telegram/bot-reset/start", json=identity, headers=secret)
    assert response.status_code == 200
    return {**identity, "confirmation_token": response.json()["confirmation_token"]}


@pytest.mark.asyncio
async def test_reset_deletes_only_own_account_and_attempts_then_allows_signup(client, db_session, secret):
    identity = await register(client, secret, "+998901234561")
    await register(client, secret, "+998901234562")
    user = await db_session.scalar(select(User).where(User.phone_number == "+998901234561"))
    old_id = user.id
    level = Level(name="Test", slug="test")
    exam = ExamType(name="Test", slug="test")
    db_session.add_all([level, exam])
    await db_session.flush()
    question = Question(prompt="Test?", correct_answer="yes")
    variant = TestVariant(level_id=level.id, exam_type_id=exam.id, title="Test", variant_number=1,
                          sections=[Section(title="Test", tasks=[Task(type="short_answer", questions=[question])])])
    db_session.add(variant)
    await db_session.flush()
    attempt = Attempt(user_id=old_id, test_variant_id=variant.id)
    db_session.add(attempt)
    await db_session.flush()
    db_session.add(AttemptAnswer(attempt_id=attempt.id, question_id=question.id, student_answer="yes"))
    await db_session.commit()
    payload = await prepare(client, secret, identity)
    assert await db_session.scalar(select(func.count()).select_from(User)) == 2  # preparation deletes nothing
    response = await client.post("/api/v1/auth/telegram/bot-reset/complete", json=payload, headers=secret)
    assert response.status_code == 200
    assert await db_session.scalar(select(func.count()).select_from(User)) == 1
    assert await db_session.scalar(select(func.count()).select_from(Attempt)) == 0
    assert await db_session.scalar(select(func.count()).select_from(AttemptAnswer)) == 0
    await client.post("/api/v1/auth/telegram/bot-contact",
                      json={**identity, "phone": "+998901234561"}, headers=secret)
    response = await client.post("/api/v1/auth/telegram/bot-register",
                                 json={**identity, "first_name": "New name"}, headers=secret)
    assert response.status_code == 201
    new_id = await db_session.scalar(select(User.id).where(User.phone_number == "+998901234561"))
    assert new_id != old_id


@pytest.mark.asyncio
async def test_confirmation_cannot_be_used_by_another_telegram_account(client, db_session, secret):
    identity = await register(client, secret, "+998901234563")
    payload = await prepare(client, secret, identity)
    response = await client.post("/api/v1/auth/telegram/bot-reset/complete",
                                 json={**payload, "telegram_user_id": "another-user"}, headers=secret)
    assert response.status_code == 409
    assert await db_session.scalar(select(func.count()).select_from(User)) == 1
    response = await client.post("/api/v1/auth/telegram/bot-reset/complete", json=payload, headers=secret)
    assert response.status_code == 200
    response = await client.post("/api/v1/auth/telegram/bot-reset/complete", json=payload, headers=secret)
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_cancel_invalidates_confirmation_and_keeps_account(client, db_session, secret):
    identity = await register(client, secret, "+998901234564")
    payload = await prepare(client, secret, identity)
    response = await client.post("/api/v1/auth/telegram/bot-reset/cancel", json=payload, headers=secret)
    assert response.status_code == 200
    response = await client.post("/api/v1/auth/telegram/bot-reset/complete", json=payload, headers=secret)
    assert response.status_code == 409
    assert await db_session.scalar(select(func.count()).select_from(User)) == 1


@pytest.mark.asyncio
async def test_admin_account_and_unsigned_requests_are_protected(client, db_session, secret):
    identity = await register(client, secret, "+998901234565")
    response = await client.post("/api/v1/auth/telegram/bot-reset/start", json=identity)
    assert response.status_code == 403
    user = await db_session.scalar(select(User).where(User.phone_number == "+998901234565"))
    user.role = Role.ADMIN
    await db_session.commit()
    response = await client.post("/api/v1/auth/telegram/bot-reset/start", json=identity, headers=secret)
    assert response.status_code == 403

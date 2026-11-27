"""Exercise login-mail rendering and delivery with real PostgreSQL and Redis fixtures.

The delivery core receives a real email service with a recording transport and
fixed deployment branding. An isolated Celery task admits malformed payloads
without changing the production task's registered arguments or worker registry.
"""

import logging

import pytest
from bs4 import BeautifulSoup
from celery import Celery
from faker import Faker
from sqlalchemy import delete
from sqlalchemy.orm import Session

from extensions.ext_mail import Mail
from libs.email_i18n import EmailI18nService, FlaskEmailRenderer, FlaskMailSender, create_default_email_config
from models import AccountStatus, TenantStatus
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from services.entities.feature_entities import BrandingModel
from tasks.mail_email_code_login import LoginCodeMailDelivery


class RecordingMailClient:
    """Accept transport messages, or raise the configured error before delivery."""

    def __init__(self) -> None:
        """Start with no deliveries and no configured transport failure."""
        self.messages: list[dict[str, str]] = []
        self.error: Exception | None = None

    def send(self, message: dict[str, str]) -> None:
        """Record an accepted message; a configured error leaves the outbox unchanged."""
        if self.error is not None:
            raise self.error
        self.messages.append(message)


class UnbrandedEmail:
    """Supply the ordinary Dify branding without consulting external services."""

    def get_branding_config(self) -> BrandingModel:
        """Return the default branding for rendering real email templates."""
        return BrandingModel()


def _assert_login_email(
    outbox: RecordingMailClient,
    to: str,
    code: str,
    subject: str = "Dify Login Code",
    text: str = "Your login code for Dify",
) -> None:
    """Require exactly one rendered delivery to the recipient in the expected locale."""
    assert len(outbox.messages) == 1
    message = outbox.messages[0]
    assert message["to"] == to
    assert message["subject"] == subject
    assert text in message["html"]
    code_field = BeautifulSoup(message["html"], "html.parser").select_one(".code")
    assert code_field is not None
    assert code_field.get_text() == code


class TestSendEmailCodeLoginMailTask:
    """Verify emitted mail, failure reporting, and preservation of existing state."""

    @pytest.fixture(autouse=True)
    def cleanup_database(self, db_session_with_containers: Session) -> None:
        """Clean up database before each test to ensure isolation."""
        from extensions.ext_redis import redis_client

        # Clear all test data
        db_session_with_containers.execute(delete(TenantAccountJoin))
        db_session_with_containers.execute(delete(Tenant))
        db_session_with_containers.execute(delete(Account))
        db_session_with_containers.commit()

        # Clear Redis cache
        redis_client.flushdb()

    @pytest.fixture
    def mail_outbox(self) -> RecordingMailClient:
        """Record transport messages without replacing application globals."""
        return RecordingMailClient()

    @pytest.fixture
    def mail_service(self, mail_outbox: RecordingMailClient) -> Mail:
        """Keep the real mail validation in front of the recording transport."""
        return Mail(client=mail_outbox, default_send_from="noreply@example.com")

    @pytest.fixture
    def email_service(self, mail_service: Mail) -> EmailI18nService:
        """Construct the real renderer and service with explicit delivery dependencies."""
        return EmailI18nService(
            config=create_default_email_config(),
            renderer=FlaskEmailRenderer(),
            branding_service=UnbrandedEmail(),
            sender=FlaskMailSender(mail_service),
        )

    @pytest.fixture
    def login_mail_delivery(self, email_service: EmailI18nService, mail_service: Mail) -> LoginCodeMailDelivery:
        """Bind the production core to the real, explicitly constructed dependencies."""
        return LoginCodeMailDelivery(mail_service, lambda: email_service)

    def _create_test_account(self, db_session_with_containers: Session, fake: Faker | None = None) -> Account:
        """
        Helper method to create a test account for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            fake: Faker instance for generating test data

        Returns:
            Account: Created account instance
        """
        if fake is None:
            fake = Faker()

        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status=AccountStatus.ACTIVE,
        )

        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        return account

    def _create_test_tenant_and_account(
        self, db_session_with_containers: Session, fake: Faker | None = None
    ) -> tuple[Account, Tenant]:
        """
        Helper method to create a test tenant and account for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            fake: Faker instance for generating test data

        Returns:
            tuple: (Account, Tenant) created instances
        """
        if fake is None:
            fake = Faker()

        # Create account using the existing helper method
        account = self._create_test_account(db_session_with_containers, fake)

        # Create tenant
        tenant = Tenant(
            name=fake.company(),
            plan="basic",
            status=TenantStatus.NORMAL,
        )

        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        # Create tenant-account relationship
        tenant_account_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
        )

        db_session_with_containers.add(tenant_account_join)
        db_session_with_containers.commit()

        return account, tenant

    def test_send_email_code_login_mail_task_success_english(
        self, mail_outbox: RecordingMailClient, login_mail_delivery: LoginCodeMailDelivery
    ) -> None:
        """An English request delivers one rendered message containing its login code."""
        login_mail_delivery.send(language="en-US", to="english@example.com", code="123456")

        _assert_login_email(mail_outbox, "english@example.com", "123456")

    def test_send_email_code_login_mail_task_success_chinese(
        self, mail_outbox: RecordingMailClient, login_mail_delivery: LoginCodeMailDelivery
    ) -> None:
        """A Simplified Chinese request delivers its localized subject and body."""
        login_mail_delivery.send(language="zh-Hans", to="chinese@example.com", code="789012")

        _assert_login_email(mail_outbox, "chinese@example.com", "789012", "Dify 登录验证码", "Dify 的登录验证码")

    def test_send_email_code_login_mail_task_success_multiple_languages(
        self, mail_outbox: RecordingMailClient, login_mail_delivery: LoginCodeMailDelivery
    ) -> None:
        """Only zh-Hans selects Chinese; other locale codes fall back to English."""
        languages = ["en-US", "zh-Hans", "zh-CN", "ja-JP", "ko-KR", "unknown-language"]
        for index, language in enumerate(languages):
            login_mail_delivery.send(language=language, to=f"recipient{index}@example.com", code=f"{index:06d}")

        assert len(mail_outbox.messages) == len(languages)
        for index, message in enumerate(mail_outbox.messages):
            assert message["to"] == f"recipient{index}@example.com"
            assert f"{index:06d}" in message["html"]
            if index == 1:
                assert message["subject"] == "Dify 登录验证码"
                assert "Dify 的登录验证码" in message["html"]
            else:
                assert message["subject"] == "Dify Login Code"
                assert "Your login code for Dify" in message["html"]

    def test_send_email_code_login_mail_task_mail_not_initialized(
        self, mail_outbox: RecordingMailClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        """An uninitialized mail service neither delivers nor reports a successful delivery."""
        caplog.set_level(logging.INFO, logger="tasks.mail_email_code_login")

        def unexpected_email_service() -> EmailI18nService:
            raise AssertionError("Unavailable mail must not resolve the email service")

        LoginCodeMailDelivery(Mail(), unexpected_email_service).send(
            language="en-US", to="unavailable@example.com", code="123456"
        )

        assert mail_outbox.messages == []
        assert caplog.messages == []

    def test_send_email_code_login_mail_task_email_service_exception(
        self,
        mail_outbox: RecordingMailClient,
        login_mail_delivery: LoginCodeMailDelivery,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """A delivery failure produces no message and is logged with its exception."""
        error = RuntimeError("Email service unavailable")
        mail_outbox.error = error
        caplog.set_level(logging.ERROR, logger="tasks.mail_email_code_login")

        login_mail_delivery.send(language="en-US", to="failed@example.com", code="123456")

        assert mail_outbox.messages == []
        [record] = [record for record in caplog.records if record.name == "tasks.mail_email_code_login"]
        assert record.getMessage() == "Send email code login mail to failed@example.com failed"
        assert record.exc_info
        assert record.exc_info[1] is error

    def test_send_email_code_login_mail_task_invalid_parameters(
        self,
        mail_outbox: RecordingMailClient,
        login_mail_delivery: LoginCodeMailDelivery,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Malformed Celery payloads retain the mail boundary's actual validation behavior."""
        cases: list[tuple[str | None, str | None]] = [
            ("", "123456"),
            (None, "123456"),
            ("empty-code@example.com", ""),
            ("none-code@example.com", None),
            ("invalid-email", "123456"),
        ]

        caplog.set_level(logging.ERROR, logger="tasks.mail_email_code_login")
        with Celery("test-login-mail-payloads", set_as_current=False) as app:
            task = app.task(shared=False, lazy=False)(login_mail_delivery.send)
            for to, code in cases:
                mail_outbox.messages.clear()
                caplog.clear()

                task.apply(kwargs={"language": "en-US", "to": to, "code": code}, throw=True)

                if not to:
                    assert mail_outbox.messages == []
                    [record] = [record for record in caplog.records if record.name == "tasks.mail_email_code_login"]
                    assert record.getMessage() == f"Send email code login mail to {to} failed"
                    assert record.exc_info
                    assert isinstance(record.exc_info[1], ValueError)
                    assert str(record.exc_info[1]) == "mail to is not set"
                else:
                    _assert_login_email(mail_outbox, to, str(code))
                    assert not [record for record in caplog.records if record.levelno >= logging.ERROR]

    def test_send_email_code_login_mail_task_edge_cases(
        self, mail_outbox: RecordingMailClient, login_mail_delivery: LoginCodeMailDelivery
    ) -> None:
        """Long addresses and unusual codes survive rendering and reach the recipient."""
        cases = [
            ("a" * 100 + "@example.com", "1" * 20),
            ("test+tag@example.com", "123-456"),
            ("test@sub.domain.example.com", "000000"),
            ("test@example.co.uk", "999999"),
            ("escaped@example.com", "<123&456>"),
        ]
        for to, code in cases:
            mail_outbox.messages.clear()

            login_mail_delivery.send(language="en-US", to=to, code=code)

            _assert_login_email(mail_outbox, to, code)

    def test_send_email_code_login_mail_task_database_integration(
        self,
        db_session_with_containers: Session,
        mail_outbox: RecordingMailClient,
        login_mail_delivery: LoginCodeMailDelivery,
    ) -> None:
        """Mail delivery uses the persisted account email and leaves the account active."""
        account, _tenant = self._create_test_tenant_and_account(db_session_with_containers)
        test_email = account.email

        login_mail_delivery.send(language="en-US", to=test_email, code="123456")

        _assert_login_email(mail_outbox, test_email, "123456")
        db_session_with_containers.refresh(account)
        assert account.email == test_email
        assert account.status == "active"

    def test_send_email_code_login_mail_task_redis_integration(
        self, mail_outbox: RecordingMailClient, login_mail_delivery: LoginCodeMailDelivery
    ) -> None:
        """Delivery leaves an existing Redis entry available and unchanged."""
        from extensions.ext_redis import redis_client

        test_email = "redis@example.com"
        cache_key = f"email_code_login_test_{test_email}"
        redis_client.set(cache_key, "test_value", ex=300)

        login_mail_delivery.send(language="en-US", to=test_email, code="123456")

        _assert_login_email(mail_outbox, test_email, "123456")
        assert redis_client.exists(cache_key) == 1
        assert redis_client.get(cache_key) == b"test_value"
        redis_client.delete(cache_key)

    def test_send_email_code_login_mail_task_error_handling_comprehensive(
        self,
        mail_outbox: RecordingMailClient,
        login_mail_delivery: LoginCodeMailDelivery,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Each transport failure is swallowed, emits no mail and retains its traceback in the log."""
        caplog.set_level(logging.ERROR, logger="tasks.mail_email_code_login")
        errors = [
            ValueError("Invalid email format"),
            RuntimeError("Service unavailable"),
            ConnectionError("Network error"),
            TimeoutError("Request timeout"),
            Exception("Generic error"),
        ]
        for error in errors:
            caplog.clear()
            mail_outbox.error = error

            login_mail_delivery.send(language="en-US", to="errors@example.com", code="123456")

            assert mail_outbox.messages == []
            [record] = [record for record in caplog.records if record.name == "tasks.mail_email_code_login"]
            assert record.getMessage() == "Send email code login mail to errors@example.com failed"
            assert record.exc_info
            assert record.exc_info[1] is error

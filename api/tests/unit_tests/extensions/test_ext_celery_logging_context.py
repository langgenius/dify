from unittest import mock

import pytest

from core.logging.context import clear_request_context, get_identity_context, set_identity_context
from dify_app import DifyApp
from extensions import ext_celery


@pytest.fixture
def celery_app():
    app = DifyApp(__name__)
    with mock.patch.object(ext_celery.Celery, "set_default"):
        yield ext_celery.init_app(app)


@pytest.fixture(autouse=True)
def _reset_logging_context():
    clear_request_context()
    yield
    clear_request_context()


def test_task_clears_logging_identity_after_success(celery_app) -> None:
    @celery_app.task(name="test.logging_context_success")
    def task() -> tuple[str, str, str]:
        set_identity_context(tenant_id="tenant-id", user_id="user-id", user_type="account")
        return get_identity_context()

    assert task() == ("tenant-id", "user-id", "account")
    assert get_identity_context() == ("", "", "")


def test_task_clears_logging_identity_after_exception(celery_app) -> None:
    @celery_app.task(name="test.logging_context_error")
    def task() -> None:
        set_identity_context(tenant_id="tenant-id", user_id="user-id", user_type="account")
        raise RuntimeError("failed")

    with pytest.raises(RuntimeError, match="failed"):
        task()

    assert get_identity_context() == ("", "", "")


def test_nested_task_restores_outer_logging_identity(celery_app) -> None:
    @celery_app.task(name="test.logging_context_inner")
    def inner_task() -> tuple[str, str, str]:
        set_identity_context(tenant_id="inner-tenant", user_id="inner-user", user_type="end_user")
        return get_identity_context()

    @celery_app.task(name="test.logging_context_outer")
    def outer_task() -> tuple[tuple[str, str, str], tuple[str, str, str]]:
        set_identity_context(tenant_id="outer-tenant", user_id="outer-user", user_type="account")
        inner_identity = inner_task()
        return inner_identity, get_identity_context()

    assert outer_task() == (
        ("inner-tenant", "inner-user", "end_user"),
        ("outer-tenant", "outer-user", "account"),
    )
    assert get_identity_context() == ("", "", "")

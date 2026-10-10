"""Real persistence checks for the resource API key boundary."""

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.enums import ApiTokenType
from models.model import ApiToken, App, AppMode
from repositories.app.api_key_repository import AppApiKeyRepository
from services.auth.api_key_contracts import (
    ApiKeyLimitExceededError,
    ApiKeyNotFoundError,
    ApiKeyResourceNotFoundError,
)


@pytest.fixture
def repository(sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]) -> AppApiKeyRepository:
    sqlite_session.add_all(
        [
            App(id="app", tenant_id="tenant", name="App", mode=AppMode.CHAT, enable_site=False, enable_api=True),
            App(
                id="other-app", tenant_id="tenant", name="Other", mode=AppMode.CHAT, enable_site=False, enable_api=True
            ),
        ]
    )
    sqlite_session.commit()
    return AppApiKeyRepository(session_factory=sqlite_session_factory)


def test_app_key_list_and_delete_preserve_owner_chain(repository: AppApiKeyRepository, sqlite_session: Session) -> None:
    sqlite_session.add_all(
        [
            ApiToken(id="current", type=ApiTokenType.APP, token="current", tenant_id="tenant", app_id="app"),
            ApiToken(id="historical", type=ApiTokenType.APP, token="historical", tenant_id=None, app_id="app"),
            ApiToken(id="foreign", type=ApiTokenType.APP, token="foreign", tenant_id="foreign", app_id="app"),
            ApiToken(id="other", type=ApiTokenType.APP, token="other", tenant_id="tenant", app_id="other-app"),
            ApiToken(id="wrong-type", type=ApiTokenType.DATASET, token="dataset", tenant_id="tenant", app_id="app"),
        ]
    )
    sqlite_session.commit()
    assert {key.id for key in repository.list_keys("tenant", "app")} == {"current", "historical"}
    for key_id in ["foreign", "other", "wrong-type", "missing"]:
        with pytest.raises(ApiKeyNotFoundError):
            repository.delete_key("tenant", "app", key_id)
    deleted = repository.delete_key("tenant", "app", "historical")
    assert deleted.token == "historical"
    assert sqlite_session.get(ApiToken, "historical") is None
    assert sqlite_session.get(ApiToken, "foreign") is not None


@pytest.mark.parametrize("operation", ["list", "create", "delete"])
def test_resource_must_belong_to_workspace(repository: AppApiKeyRepository, operation: str) -> None:
    def invoke() -> object:
        if operation == "list":
            return repository.list_keys("foreign", "app")
        if operation == "create":
            return repository.create_key("foreign", "app", max_keys=10, prefix="test-")
        return repository.delete_key("foreign", "app", "missing")

    with pytest.raises(ApiKeyResourceNotFoundError):
        invoke()


def test_creation_counts_historical_keys_but_not_foreign_keys(
    repository: AppApiKeyRepository,
    sqlite_session: Session,
) -> None:
    sqlite_session.add_all(
        [ApiToken(type=ApiTokenType.APP, token=f"foreign-{i}", tenant_id="foreign", app_id="app") for i in range(10)]
    )
    sqlite_session.add_all(
        [ApiToken(type=ApiTokenType.APP, token=f"historical-{i}", tenant_id=None, app_id="app") for i in range(9)]
    )
    sqlite_session.commit()

    created = repository.create_key("tenant", "app", max_keys=10, prefix="app-")
    assert created.token.startswith("app-")
    assert len(created.token) == 28
    assert created.created_at is not None
    with pytest.raises(ApiKeyLimitExceededError):
        repository.create_key("tenant", "app", max_keys=10, prefix="app-")
    stored = sqlite_session.get(ApiToken, created.id)
    assert stored is not None
    assert (stored.tenant_id, stored.app_id, stored.type) == ("tenant", "app", ApiTokenType.APP)
    assert len(repository.list_keys("tenant", "app")) == 10

import pytest

from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from services.end_user_connection_identity import connection_context_from_web_passport
from services.end_user_connections.entities import ConnectionOwner
from services.end_user_connections.errors import ConnectionConfigurationError, ConnectionIdentityError


@pytest.fixture
def app_identity() -> App:
    return App(id="app", tenant_id="tenant", name="Consumer App", mode=AppMode.WORKFLOW)


@pytest.fixture
def browser_identity() -> EndUser:
    return EndUser(id="user", tenant_id="tenant", app_id="app", type=EndUserType.BROWSER, account_id=None)


@pytest.mark.parametrize("account_id", [None, "account"])
def test_existing_web_identity_maps_to_owner_without_workspace_membership(
    app_identity: App, browser_identity: EndUser, account_id: str | None
) -> None:
    browser_identity.account_id = account_id
    context = connection_context_from_web_passport(app=app_identity, end_user=browser_identity)
    assert context.app_id == app_identity.id
    assert context.tenant_id == app_identity.tenant_id
    assert context.end_user_id == browser_identity.id
    assert context.owner == ConnectionOwner(
        account_id=account_id, end_user_id=None if account_id else browser_identity.id
    )


def test_external_identity_and_browser_session_never_become_account_ids(
    app_identity: App, browser_identity: EndUser
) -> None:
    browser_identity.external_user_id = "some-account-id"
    browser_identity.session_id = "some-account-id"
    context = connection_context_from_web_passport(app=app_identity, end_user=browser_identity)
    assert context.owner == ConnectionOwner(account_id=None, end_user_id=browser_identity.id)


@pytest.mark.parametrize("field", ["tenant_id", "app_id"])
def test_mismatched_app_end_user_chain_is_rejected(app_identity: App, browser_identity: EndUser, field: str) -> None:
    setattr(browser_identity, field, "other")
    with pytest.raises(ConnectionIdentityError):
        connection_context_from_web_passport(app=app_identity, end_user=browser_identity)


@pytest.mark.parametrize("end_user_type", [EndUserType.SERVICE_API, EndUserType.APP_DEPLOY])
def test_other_entry_identities_cannot_use_the_web_adapter(
    app_identity: App, browser_identity: EndUser, end_user_type: EndUserType
) -> None:
    browser_identity.type = end_user_type
    with pytest.raises(ConnectionIdentityError):
        connection_context_from_web_passport(app=app_identity, end_user=browser_identity)


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
def test_workflow_and_chatflow_are_supported(app_identity: App, browser_identity: EndUser, mode: AppMode) -> None:
    app_identity.mode = mode
    assert connection_context_from_web_passport(app=app_identity, end_user=browser_identity).app_id == app_identity.id


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.COMPLETION, AppMode.AGENT_CHAT])
def test_other_app_modes_are_not_enabled(app_identity: App, browser_identity: EndUser, mode: AppMode) -> None:
    app_identity.mode = mode
    with pytest.raises(ConnectionConfigurationError):
        connection_context_from_web_passport(app=app_identity, end_user=browser_identity)

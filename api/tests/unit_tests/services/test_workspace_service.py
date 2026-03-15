from __future__ import annotations

from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from models.account import Tenant

# ---------------------------------------------------------------------------
# Constants used throughout the tests
# ---------------------------------------------------------------------------

TENANT_ID = "tenant-abc"
ACCOUNT_ID = "account-xyz"
FILES_BASE_URL = "https://files.example.com"

DB_PATH = "services.workspace_service.db"
FEATURE_SERVICE_PATH = "services.workspace_service.FeatureService.get_features"
TENANT_SERVICE_PATH = "services.workspace_service.TenantService.has_roles"
DIFY_CONFIG_PATH = "services.workspace_service.dify_config"
CURRENT_USER_PATH = "services.workspace_service.current_user"
CREDIT_POOL_SERVICE_PATH = "services.credit_pool_service.CreditPoolService.get_pool"


# ---------------------------------------------------------------------------
# Helpers / factories
# ---------------------------------------------------------------------------


def _make_tenant(
    tenant_id: str = TENANT_ID,
    name: str = "My Workspace",
    plan: str = "sandbox",
    status: str = "active",
    custom_config: dict | None = None,
) -> Tenant:
    """Create a minimal Tenant-like namespace."""
    return cast(
        Tenant,
        SimpleNamespace(
            id=tenant_id,
            name=name,
            plan=plan,
            status=status,
            created_at="2024-01-01T00:00:00Z",
            custom_config_dict=custom_config or {},
        ),
    )


def _make_feature(
    can_replace_logo: bool = False,
    next_credit_reset_date: str | None = None,
    billing_plan: str = "sandbox",
) -> MagicMock:
    """Create a feature namespace matching what FeatureService.get_features returns."""
    feature = MagicMock()
    feature.can_replace_logo = can_replace_logo
    feature.next_credit_reset_date = next_credit_reset_date
    feature.billing.subscription.plan = billing_plan
    return feature


def _make_pool(quota_limit: int, quota_used: int) -> MagicMock:
    pool = MagicMock()
    pool.quota_limit = quota_limit
    pool.quota_used = quota_used
    return pool


def _make_tenant_account_join(role: str = "normal") -> SimpleNamespace:
    return SimpleNamespace(role=role)


def _tenant_info(result: object) -> dict[str, Any] | None:
    return cast(dict[str, Any] | None, result)


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_current_user() -> SimpleNamespace:
    """Return a lightweight current_user stand-in."""
    return SimpleNamespace(id=ACCOUNT_ID)


@pytest.fixture
def basic_mocks(mocker: MockerFixture, mock_current_user: SimpleNamespace) -> dict:
    """
    Patch the common external boundaries used by WorkspaceService.get_tenant_info.

    Returns a dict of named mocks so individual tests can customise them.
    """
    mocker.patch(CURRENT_USER_PATH, mock_current_user)

    mock_db_session = mocker.patch(f"{DB_PATH}.session")
    mock_query_chain = MagicMock()
    mock_db_session.query.return_value = mock_query_chain
    mock_query_chain.where.return_value = mock_query_chain
    mock_query_chain.first.return_value = _make_tenant_account_join(role="owner")

    mock_feature = mocker.patch(FEATURE_SERVICE_PATH, return_value=_make_feature())
    mock_has_roles = mocker.patch(TENANT_SERVICE_PATH, return_value=False)
    mock_config = mocker.patch(DIFY_CONFIG_PATH)
    mock_config.EDITION = "SELF_HOSTED"
    mock_config.FILES_URL = FILES_BASE_URL

    return {
        "db_session": mock_db_session,
        "query_chain": mock_query_chain,
        "get_features": mock_feature,
        "has_roles": mock_has_roles,
        "config": mock_config,
    }


# ---------------------------------------------------------------------------
# 1. None Tenant Handling
# ---------------------------------------------------------------------------


def test_get_tenant_info_should_return_none_when_tenant_is_none() -> None:
    """get_tenant_info should short-circuit and return None for a falsy tenant."""
    from services.workspace_service import WorkspaceService

    # Arrange
    tenant = None

    # Act
    result = WorkspaceService.get_tenant_info(cast(Tenant, tenant))

    # Assert
    assert result is None


def test_get_tenant_info_should_return_none_when_tenant_is_falsy() -> None:
    """get_tenant_info treats any falsy value as absent (e.g. empty string, 0)."""
    from services.workspace_service import WorkspaceService

    # Arrange / Act / Assert
    assert WorkspaceService.get_tenant_info("") is None  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# 2. Basic Tenant Info — happy path
# ---------------------------------------------------------------------------


def test_get_tenant_info_should_return_base_fields(
    mocker: MockerFixture,
    basic_mocks: dict,
) -> None:
    """get_tenant_info should always return the six base scalar fields."""
    from services.workspace_service import WorkspaceService

    # Arrange
    tenant = _make_tenant()

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert result["id"] == TENANT_ID
    assert result["name"] == "My Workspace"
    assert result["plan"] == "sandbox"
    assert result["status"] == "active"
    assert result["created_at"] == "2024-01-01T00:00:00Z"
    assert result["trial_end_reason"] is None


def test_get_tenant_info_should_populate_role_from_tenant_account_join(
    mocker: MockerFixture,
    basic_mocks: dict,
) -> None:
    """The 'role' field should be taken from TenantAccountJoin, not the default."""
    from services.workspace_service import WorkspaceService

    # Arrange
    basic_mocks["query_chain"].first.return_value = _make_tenant_account_join(role="admin")
    tenant = _make_tenant()

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert result["role"] == "admin"


def test_get_tenant_info_should_raise_assertion_when_tenant_account_join_missing(
    mocker: MockerFixture,
    basic_mocks: dict,
) -> None:
    """
    The service asserts that TenantAccountJoin exists.
    Missing join should raise AssertionError.
    """
    from services.workspace_service import WorkspaceService

    # Arrange
    basic_mocks["query_chain"].first.return_value = None
    tenant = _make_tenant()

    # Act + Assert
    with pytest.raises(AssertionError, match="TenantAccountJoin not found"):
        WorkspaceService.get_tenant_info(tenant)


# ---------------------------------------------------------------------------
# 3. Logo Customisation
# ---------------------------------------------------------------------------


def test_get_tenant_info_should_include_custom_config_when_logo_allowed_and_admin(
    mocker: MockerFixture,
    basic_mocks: dict,
) -> None:
    """custom_config block should appear for OWNER/ADMIN when can_replace_logo is True."""
    from services.workspace_service import WorkspaceService

    # Arrange
    basic_mocks["get_features"].return_value = _make_feature(can_replace_logo=True)
    basic_mocks["has_roles"].return_value = True
    tenant = _make_tenant(
        custom_config={
            "replace_webapp_logo": True,
            "remove_webapp_brand": True,
        }
    )

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert "custom_config" in result
    assert result["custom_config"]["remove_webapp_brand"] is True
    expected_logo_url = f"{FILES_BASE_URL}/files/workspaces/{TENANT_ID}/webapp-logo"
    assert result["custom_config"]["replace_webapp_logo"] == expected_logo_url


def test_get_tenant_info_should_set_replace_webapp_logo_to_none_when_flag_absent(
    mocker: MockerFixture,
    basic_mocks: dict,
) -> None:
    """replace_webapp_logo should be None when custom_config_dict does not have the key."""
    from services.workspace_service import WorkspaceService

    # Arrange
    basic_mocks["get_features"].return_value = _make_feature(can_replace_logo=True)
    basic_mocks["has_roles"].return_value = True
    tenant = _make_tenant(custom_config={})  # no replace_webapp_logo key

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert result["custom_config"]["replace_webapp_logo"] is None


def test_get_tenant_info_should_not_include_custom_config_when_logo_not_allowed(
    mocker: MockerFixture,
    basic_mocks: dict,
) -> None:
    """custom_config should be absent when can_replace_logo is False."""
    from services.workspace_service import WorkspaceService

    # Arrange
    basic_mocks["get_features"].return_value = _make_feature(can_replace_logo=False)
    basic_mocks["has_roles"].return_value = True
    tenant = _make_tenant()

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert "custom_config" not in result


def test_get_tenant_info_should_not_include_custom_config_when_user_not_admin(
    mocker: MockerFixture,
    basic_mocks: dict,
) -> None:
    """custom_config block is gated on OWNER or ADMIN role."""
    from services.workspace_service import WorkspaceService

    # Arrange
    basic_mocks["get_features"].return_value = _make_feature(can_replace_logo=True)
    basic_mocks["has_roles"].return_value = False  # regular member
    tenant = _make_tenant()

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert "custom_config" not in result


def test_get_tenant_info_should_use_files_url_for_logo_url(
    mocker: MockerFixture,
    basic_mocks: dict,
) -> None:
    """The logo URL should use dify_config.FILES_URL as the base."""
    from services.workspace_service import WorkspaceService

    # Arrange
    custom_base = "https://cdn.mycompany.io"
    basic_mocks["config"].FILES_URL = custom_base
    basic_mocks["get_features"].return_value = _make_feature(can_replace_logo=True)
    basic_mocks["has_roles"].return_value = True
    tenant = _make_tenant(custom_config={"replace_webapp_logo": True})

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert result["custom_config"]["replace_webapp_logo"].startswith(custom_base)


# ---------------------------------------------------------------------------
# 4. Cloud-Edition Credit Features
# ---------------------------------------------------------------------------

CLOUD_BILLING_PLAN_NON_SANDBOX = "professional"  # any plan that is not SANDBOX


@pytest.fixture
def cloud_mocks(mocker: MockerFixture, mock_current_user: SimpleNamespace) -> dict:
    """Patches for CLOUD edition tests, billing plan = professional by default."""
    mocker.patch(CURRENT_USER_PATH, mock_current_user)

    mock_db_session = mocker.patch(f"{DB_PATH}.session")
    mock_query_chain = MagicMock()
    mock_db_session.query.return_value = mock_query_chain
    mock_query_chain.where.return_value = mock_query_chain
    mock_query_chain.first.return_value = _make_tenant_account_join(role="owner")

    mock_feature = mocker.patch(
        FEATURE_SERVICE_PATH,
        return_value=_make_feature(
            can_replace_logo=False,
            next_credit_reset_date="2025-02-01",
            billing_plan=CLOUD_BILLING_PLAN_NON_SANDBOX,
        ),
    )
    mocker.patch(TENANT_SERVICE_PATH, return_value=False)
    mock_config = mocker.patch(DIFY_CONFIG_PATH)
    mock_config.EDITION = "CLOUD"
    mock_config.FILES_URL = FILES_BASE_URL

    return {
        "db_session": mock_db_session,
        "query_chain": mock_query_chain,
        "get_features": mock_feature,
        "config": mock_config,
    }


def test_get_tenant_info_should_add_next_credit_reset_date_in_cloud_edition(
    mocker: MockerFixture,
    cloud_mocks: dict,
) -> None:
    """next_credit_reset_date should be present in CLOUD edition."""
    from services.workspace_service import WorkspaceService

    # Arrange
    mocker.patch(
        CREDIT_POOL_SERVICE_PATH,
        side_effect=[None, None],  # both paid and trial pools absent
    )
    tenant = _make_tenant()

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert result["next_credit_reset_date"] == "2025-02-01"


def test_get_tenant_info_should_use_paid_pool_when_plan_is_not_sandbox_and_pool_not_full(
    mocker: MockerFixture,
    cloud_mocks: dict,
) -> None:
    """trial_credits/trial_credits_used come from the paid pool when conditions are met."""
    from services.workspace_service import WorkspaceService

    # Arrange
    paid_pool = _make_pool(quota_limit=1000, quota_used=200)
    mocker.patch(CREDIT_POOL_SERVICE_PATH, return_value=paid_pool)
    tenant = _make_tenant()

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert result["trial_credits"] == 1000
    assert result["trial_credits_used"] == 200


def test_get_tenant_info_should_use_paid_pool_when_quota_limit_is_infinite(
    mocker: MockerFixture,
    cloud_mocks: dict,
) -> None:
    """quota_limit == -1 means unlimited; service should still use the paid pool."""
    from services.workspace_service import WorkspaceService

    # Arrange
    paid_pool = _make_pool(quota_limit=-1, quota_used=999)
    mocker.patch(CREDIT_POOL_SERVICE_PATH, side_effect=[paid_pool, None])
    tenant = _make_tenant()

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert result["trial_credits"] == -1
    assert result["trial_credits_used"] == 999


def test_get_tenant_info_should_fall_back_to_trial_pool_when_paid_pool_is_full(
    mocker: MockerFixture,
    cloud_mocks: dict,
) -> None:
    """When paid pool is exhausted (used >= limit), switch to trial pool."""
    from services.workspace_service import WorkspaceService

    # Arrange
    paid_pool = _make_pool(quota_limit=500, quota_used=500)  # exactly full
    trial_pool = _make_pool(quota_limit=100, quota_used=10)
    mocker.patch(CREDIT_POOL_SERVICE_PATH, side_effect=[paid_pool, trial_pool])
    tenant = _make_tenant()

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert result["trial_credits"] == 100
    assert result["trial_credits_used"] == 10


def test_get_tenant_info_should_fall_back_to_trial_pool_when_paid_pool_is_none(
    mocker: MockerFixture,
    cloud_mocks: dict,
) -> None:
    """When paid_pool is None, fall back to trial pool."""
    from services.workspace_service import WorkspaceService

    # Arrange
    trial_pool = _make_pool(quota_limit=50, quota_used=5)
    mocker.patch(CREDIT_POOL_SERVICE_PATH, side_effect=[None, trial_pool])
    tenant = _make_tenant()

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert result["trial_credits"] == 50
    assert result["trial_credits_used"] == 5


def test_get_tenant_info_should_fall_back_to_trial_pool_for_sandbox_plan(
    mocker: MockerFixture,
    cloud_mocks: dict,
) -> None:
    """
    When the subscription plan IS SANDBOX, the paid pool branch is skipped
    entirely and we fall back to the trial pool.
    """
    from enums.cloud_plan import CloudPlan
    from services.workspace_service import WorkspaceService

    # Arrange — override billing plan to SANDBOX
    cloud_mocks["get_features"].return_value = _make_feature(
        next_credit_reset_date="2025-02-01",
        billing_plan=CloudPlan.SANDBOX,
    )
    paid_pool = _make_pool(quota_limit=1000, quota_used=0)
    trial_pool = _make_pool(quota_limit=200, quota_used=20)
    mocker.patch(CREDIT_POOL_SERVICE_PATH, side_effect=[paid_pool, trial_pool])
    tenant = _make_tenant()

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert result["trial_credits"] == 200
    assert result["trial_credits_used"] == 20


def test_get_tenant_info_should_omit_trial_credits_when_both_pools_are_none(
    mocker: MockerFixture,
    cloud_mocks: dict,
) -> None:
    """When both paid and trial pools are absent, trial_credits should not be set."""
    from services.workspace_service import WorkspaceService

    # Arrange
    mocker.patch(CREDIT_POOL_SERVICE_PATH, side_effect=[None, None])
    tenant = _make_tenant()

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert "trial_credits" not in result
    assert "trial_credits_used" not in result


# ---------------------------------------------------------------------------
# 5. Self-hosted / Non-Cloud Edition
# ---------------------------------------------------------------------------


def test_get_tenant_info_should_not_include_cloud_fields_in_self_hosted(
    mocker: MockerFixture,
    basic_mocks: dict,
) -> None:
    """next_credit_reset_date and trial_credits should NOT appear in SELF_HOSTED mode."""
    from services.workspace_service import WorkspaceService

    # Arrange  (basic_mocks already sets EDITION = "SELF_HOSTED")
    tenant = _make_tenant()

    # Act
    result = _tenant_info(WorkspaceService.get_tenant_info(tenant))

    # Assert
    assert result is not None
    assert "next_credit_reset_date" not in result
    assert "trial_credits" not in result
    assert "trial_credits_used" not in result


# ---------------------------------------------------------------------------
# 6. DB query integrity
# ---------------------------------------------------------------------------


def test_get_tenant_info_should_query_tenant_account_join_with_correct_ids(
    mocker: MockerFixture,
    basic_mocks: dict,
) -> None:
    """
    The DB query for TenantAccountJoin must be scoped to the correct
    tenant_id and current_user.id.
    """
    from services.workspace_service import WorkspaceService

    # Arrange
    tenant = _make_tenant(tenant_id="my-special-tenant")
    mock_current_user = mocker.patch(CURRENT_USER_PATH)
    mock_current_user.id = "special-user-id"

    # Act
    WorkspaceService.get_tenant_info(tenant)

    # Assert — db.session.query was invoked (at least once)
    basic_mocks["db_session"].query.assert_called()

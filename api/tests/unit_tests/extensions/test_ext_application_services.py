"""Tests for application-service dependency wiring."""

import json
import logging
from collections.abc import Mapping
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, call, patch
from uuid import uuid4

import httpx
import pytest
from flask import Flask
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition, WebAppAccessMode
from extensions import ext_application_services
from extensions.ext_redis import RedisClientWrapper
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import AccountTrialAppRecord, App, AppMode, AppModelConfig, DifySetup, InstalledApp
from repositories.account_activation_repository import SQLAlchemyAccountActivationRepository
from repositories.account_integration_repository import SQLAlchemyAccountIntegrationRepository
from repositories.account_oauth_repository import (
    AccountServiceOAuthAccountRegistrationGateway,
    AccountServiceOAuthSessionGateway,
    AccountServiceOAuthWorkspaceGateway,
    RegisterServiceOAuthInvitationGateway,
)
from repositories.account_repository import SQLAlchemyAccountRepository
from repositories.app_site_command_repository import AppSiteCommandRepository
from repositories.app_statistic_query_repository import AppStatisticQueryRepository
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from repositories.workflow_app_log_query_repository import WorkflowAppLogQueryRepository
from repositories.workflow_run_archive_repository import WorkflowRunArchiveBundleQueryRepository
from services import account_forgot_password_service, recommended_app_catalog_gateway
from services.account_adapters import (
    BillingAccountActivationEligibility,
    BillingWorkspaceMembershipCache,
    DeploymentWorkspaceInvitePolicy,
    RBACWorkspaceMemberAccessSync,
    RedisInvitationTokenStore,
)
from services.account_avatar_file_gateway import SQLAlchemyAccountAvatarFileGateway
from services.account_email_registration_adapters import (
    AccountServiceRegistrationGateway,
    BillingAccountRegistrationPolicyGateway,
    RedisEmailRegistrationSecurityGateway,
    TokenManagerEmailRegistrationTokenGateway,
)
from services.account_forgot_password_adapters import (
    RateLimiterForgotPasswordSendLimiter,
    RedisForgotPasswordSecurityGateway,
    RedisForgotPasswordTokenGateway,
)
from services.account_oauth_adapters import (
    DeploymentOAuthPolicyGateway,
    RedisOAuthAccountClaimLock,
)
from services.app_site_service import AppSiteService
from services.auth.data_source_api_key_auth_service import DataSourceApiKeyAuthService
from services.billing_portal_service import BillingPortalService
from services.billing_service import BillingService
from services.compliance_download_service import ComplianceDownloadService
from services.errors.enterprise import EnterpriseAPIError, EnterpriseAPINotFoundError, EnterpriseServiceError
from services.file_service import FileService
from services.init_validation_service import InvalidInitializationPasswordError
from services.installed_app_access_service import InstalledAppAccessDeniedError, InstalledAppRef
from services.partner_tenant_binding_service import PartnerTenantBindingService
from services.retention.workflow_run.archive_download_task_cache import WorkflowRunArchiveDownloadTaskCache
from services.retention.workflow_run.archive_log_service import WorkflowRunArchiveService
from services.tag_application_service import TagApplicationService
from services.webapp_access_query_service import WebAppAccessQueryService, WebAppAccessUnavailableError
from services.workflow_app_log_query_service import WorkflowAppLogQueryService
from services.workflow_run_service import WorkflowRunService
from services.workflow_statistic_query_service import WorkflowStatisticQueryService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.services.test_app_task_service import _StopRedis


@pytest.mark.parametrize(
    ("deployment_edition", "initialization_password", "session_validated", "setup_exists", "expected"),
    [
        pytest.param(DeploymentEdition.CLOUD, "expected", False, False, True, id="cloud"),
        pytest.param(DeploymentEdition.COMMUNITY, "", False, False, True, id="no-password"),
        pytest.param(DeploymentEdition.COMMUNITY, "expected", False, False, False, id="not-validated"),
        pytest.param(DeploymentEdition.ENTERPRISE, "expected", False, False, False, id="enterprise"),
        pytest.param(DeploymentEdition.COMMUNITY, "expected", True, False, True, id="browser-session"),
        pytest.param(DeploymentEdition.COMMUNITY, "expected", False, True, True, id="setup-record"),
    ],
)
def test_build_application_services_configures_init_validation(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    deployment_edition: DeploymentEdition,
    initialization_password: str,
    session_validated: bool,
    setup_exists: bool,
    expected: bool,
) -> None:
    if setup_exists:
        sqlite_session.add(DifySetup(version="test-version"))
        sqlite_session.commit()

    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=deployment_edition,
        initialization_password=initialization_password,
        redis=MagicMock(spec=RedisClientWrapper),
    )

    assert services.init_validation.is_validated(session_validated=session_validated) is expected


def test_build_application_services_passes_the_expected_password(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="expected",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    services.init_validation.validate_password("expected")
    with pytest.raises(InvalidInitializationPasswordError):
        services.init_validation.validate_password("wrong")


def test_init_app_registers_services_for_the_current_app(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app = Flask(__name__)
    monkeypatch.setattr(ext_application_services, "get_session_maker", lambda: sqlite_session_factory)
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        INIT_PASSWORD="expected",
    )

    ext_application_services.init_app(app)

    with app.app_context():
        services = ext_application_services.application_services()
        assert services is app.extensions["application_services"]
        assert services.init_validation.is_validated(session_validated=False) is False
        assert isinstance(services.workflow_statistics, WorkflowStatisticQueryService)


@pytest.mark.parametrize(
    ("deployment_edition", "setup_completed"),
    [
        pytest.param(DeploymentEdition.CLOUD, True, id="cloud"),
        pytest.param(DeploymentEdition.COMMUNITY, False, id="community"),
        pytest.param(DeploymentEdition.ENTERPRISE, False, id="enterprise"),
    ],
)
def test_build_application_services_configures_setup_policy(
    sqlite_session_factory: sessionmaker[Session],
    deployment_edition: DeploymentEdition,
    setup_completed: bool,
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=deployment_edition,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    assert services.setup.get_status().completed is setup_completed
    assert services.oauth_server is not None


def test_build_application_services_wires_builtin_schema_definitions(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    definitions = services.schema_definitions.list()

    assert definitions
    assert all({"name", "label", "schema"} <= definition.keys() for definition in definitions)


def test_build_application_services_does_not_construct_schema_manager(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with patch("extensions.ext_application_services.SchemaManager") as schema_manager:
        ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=MagicMock(spec=RedisClientWrapper),
        )

    schema_manager.assert_not_called()


def test_build_application_services_wires_tag_boundary(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    assert isinstance(services.tags, TagApplicationService)


def test_build_application_services_reuses_file_service(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    assert isinstance(services.files, FileService)
    assert services.files._session_maker is sqlite_session_factory
    assert services.web_app_runtime._file_service is services.files


def test_build_application_services_wires_workflow_run_archives(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    redis = MagicMock(spec=RedisClientWrapper)

    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis,
    )

    workflow_run_archives = services.workflow_run_archives
    assert isinstance(workflow_run_archives, WorkflowRunArchiveService)
    assert isinstance(workflow_run_archives._bundles, WorkflowRunArchiveBundleQueryRepository)
    assert workflow_run_archives._bundles._session_factory is sqlite_session_factory
    assert isinstance(workflow_run_archives._tasks, WorkflowRunArchiveDownloadTaskCache)
    assert workflow_run_archives._tasks._redis is redis
    assert workflow_run_archives._dispatcher is ext_application_services.dispatch_workflow_run_archive_download_task
    assert workflow_run_archives._sign_download_url is ext_application_services.sign_workflow_run_archive_download_url


def test_build_application_services_wires_app_site_boundary(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    assert isinstance(services.app_sites, AppSiteService)
    assert isinstance(services.app_sites._sites, AppSiteCommandRepository)
    assert services.app_sites._sites._session_factory is sqlite_session_factory


def test_build_application_services_wires_workflow_app_log_boundary(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    assert isinstance(services.workflow_app_logs, WorkflowAppLogQueryService)
    assert isinstance(services.workflow_app_logs._logs, WorkflowAppLogQueryRepository)
    assert services.workflow_app_logs._logs._session_factory is sqlite_session_factory


def test_build_application_services_wires_app_statistic_boundary(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    assert isinstance(services.app_statistics, AppStatisticQueryRepository)
    assert services.app_statistics._session_factory is sqlite_session_factory


def test_build_application_services_wires_workflow_run_service(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    workflow_runs = services.workflow_runs
    assert isinstance(workflow_runs, WorkflowRunService)
    assert isinstance(workflow_runs._workflow_runs, DifyAPISQLAlchemyWorkflowRunRepository)
    assert workflow_runs._workflow_runs._session_maker is sqlite_session_factory


def test_build_application_services_wires_billing_service(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = Account(name="Billing Owner", email="owner@example.com")
    account.id = "account-1"
    sqlite_session.add(account)
    sqlite_session.commit()

    with (
        patch.object(
            BillingService,
            "get_subscription",
            return_value={"url": "https://billing.example.com/checkout"},
        ) as get_subscription,
        patch.object(
            BillingService,
            "get_invoices",
            return_value={"url": "https://billing.example.com/portal"},
        ) as get_invoices,
        patch.object(
            BillingService,
            "sync_partner_tenants_bindings",
            return_value={"result": "success"},
        ) as sync_partner_tenants_bindings,
    ):
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=MagicMock(spec=RedisClientWrapper),
        )

    request_context = RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )
    assert isinstance(services.billing_portal, BillingPortalService)
    assert services.billing_portal.get_subscription(
        request_context,
        plan="professional",
        interval="month",
    ) == {"url": "https://billing.example.com/checkout"}
    assert services.billing_portal.get_invoices(request_context) == {"url": "https://billing.example.com/portal"}
    assert isinstance(services.partner_tenant_bindings, PartnerTenantBindingService)
    assert services.partner_tenant_bindings.sync(
        account_id="account-1",
        partner_key="partner-key",
        click_id="click-1",
    ) == {"result": "success"}
    get_subscription.assert_called_once_with("professional", "month", "owner@example.com", "workspace-1")
    get_invoices.assert_called_once_with("owner@example.com", "workspace-1")
    sync_partner_tenants_bindings.assert_called_once_with("account-1", "partner-key", "click-1")


def test_build_application_services_wires_compliance_downloads(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    with (
        patch.object(
            BillingService,
            "get_compliance_download_link",
            return_value={"url": "https://billing.example.com/compliance"},
        ) as fetch_link,
        patch("extensions.ext_application_services.RateLimiter") as rate_limiter_type,
    ):
        rate_limiter = rate_limiter_type.return_value
        rate_limiter.is_rate_limited.return_value = False
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=redis,
        )

    assert isinstance(services.compliance_downloads, ComplianceDownloadService)
    assert services.compliance_downloads.get_link(
        request_context=RequestContext(
            request_id="request-1",
            trace_id="trace-1",
            account_id="account-1",
            active_workspace_id="workspace-1",
        ),
        document_name="SOC2_Type_II",
        ip_address="127.0.0.1",
        device_info="test-agent",
    ) == {"url": "https://billing.example.com/compliance"}
    rate_limiter_type.assert_any_call(
        prefix="compliance_download_rate_limiter",
        max_attempts=4,
        time_window=60,
        redis_client=redis,
    )
    rate_limiter.is_rate_limited.assert_called_once_with("account-1:workspace-1")
    rate_limiter.increment_rate_limit.assert_called_once_with("account-1:workspace-1")
    fetch_link.assert_called_once_with("SOC2_Type_II", "account-1", "workspace-1", "127.0.0.1", "test-agent")


def test_build_application_services_wires_education_rate_limiters(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    with patch("extensions.ext_application_services.RateLimiter") as rate_limiter_type:
        ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=redis,
        )

    rate_limiter_type.assert_any_call(
        prefix="edu_verification_rate_limit",
        max_attempts=10,
        time_window=60,
        redis_client=redis,
    )
    rate_limiter_type.assert_any_call(
        prefix="edu_activation_rate_limit",
        max_attempts=10,
        time_window=60,
        redis_client=redis,
    )


def test_build_application_services_wires_account_profile_repository(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    accounts = services.accounts.profile._accounts
    assert isinstance(accounts, SQLAlchemyAccountRepository)
    assert accounts._session_factory is sqlite_session_factory
    assert services.accounts.password._accounts is accounts
    assert services.accounts.authentication._passwords is services.accounts.password._passwords
    forgot_password = services.accounts.forgot_password
    assert forgot_password._accounts is accounts
    assert forgot_password._passwords is services.accounts.password._passwords
    tokens = cast(RedisForgotPasswordTokenGateway, forgot_password._tokens)
    send_limiter = cast(RateLimiterForgotPasswordSendLimiter, forgot_password._send_limits)
    security = cast(RedisForgotPasswordSecurityGateway, forgot_password._security)
    assert tokens._redis is send_limiter._rate_limiter._redis_client
    assert send_limiter._rate_limiter.prefix == account_forgot_password_service.FORGOT_PASSWORD_SEND_RATE_LIMIT_PREFIX
    assert (
        send_limiter._rate_limiter.max_attempts
        == account_forgot_password_service.FORGOT_PASSWORD_SEND_RATE_LIMIT_MAX_ATTEMPTS
    )
    assert (
        security._verification_failure_limit
        == account_forgot_password_service.FORGOT_PASSWORD_VERIFICATION_FAILURE_LIMIT
    )
    assert security._verification_key_prefix == account_forgot_password_service.FORGOT_PASSWORD_VERIFICATION_KEY_PREFIX
    assert services.accounts.initialization._accounts is accounts
    assert not services.accounts.initialization._invitation_required
    assert services.accounts.change_email._accounts is accounts
    email_registration = services.accounts.email_registration
    assert email_registration._accounts is accounts
    assert isinstance(email_registration._tokens, TokenManagerEmailRegistrationTokenGateway)
    assert isinstance(email_registration._security, RedisEmailRegistrationSecurityGateway)
    assert isinstance(email_registration._account_policy, BillingAccountRegistrationPolicyGateway)
    assert isinstance(email_registration._registration, AccountServiceRegistrationGateway)
    assert email_registration._registration._session_factory is sqlite_session_factory
    assert services.accounts.education._accounts is accounts
    assert services.accounts.deletion._accounts is accounts
    assert services.accounts.authentication._accounts is accounts
    assert services.accounts.authentication._workspaces is services.workspace_queries._workspaces
    assert services.step_by_step_tour._accounts is accounts
    assert services.accounts.deletion._memberships is services.workspace_queries._workspaces
    integrations = services.accounts.integrations._integrations
    assert isinstance(integrations, SQLAlchemyAccountIntegrationRepository)
    assert integrations._session_factory is sqlite_session_factory
    oauth = services.accounts.oauth
    assert oauth._accounts is accounts
    assert oauth._integrations is integrations
    assert oauth._memberships is services.workspace_queries._workspaces
    assert isinstance(oauth._invitations, RegisterServiceOAuthInvitationGateway)
    assert isinstance(oauth._account_claims, RedisOAuthAccountClaimLock)
    assert isinstance(oauth._registration, AccountServiceOAuthAccountRegistrationGateway)
    assert isinstance(oauth._workspaces, AccountServiceOAuthWorkspaceGateway)
    assert isinstance(oauth._sessions, AccountServiceOAuthSessionGateway)
    assert oauth._sessions is not oauth._workspaces
    assert isinstance(oauth._registration_policy, DeploymentOAuthPolicyGateway)
    assert oauth._workspace_policy is oauth._registration_policy
    avatar_files = services.accounts.avatar._files
    assert isinstance(avatar_files, SQLAlchemyAccountAvatarFileGateway)
    assert avatar_files._session_factory is sqlite_session_factory


def test_build_application_services_requires_invitation_for_cloud_initialization(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.CLOUD,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    assert services.accounts.initialization._invitation_required


@pytest.mark.parametrize(
    ("deployment_edition", "billing_enabled"),
    [
        pytest.param(DeploymentEdition.CLOUD, True, id="cloud"),
        pytest.param(DeploymentEdition.COMMUNITY, False, id="community"),
        pytest.param(DeploymentEdition.ENTERPRISE, False, id="enterprise"),
    ],
)
def test_build_application_services_wires_account_activation(
    sqlite_session_factory: sessionmaker[Session],
    deployment_edition: DeploymentEdition,
    billing_enabled: bool,
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=deployment_edition,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    activation = services.account_activation
    assert isinstance(activation._tokens, RedisInvitationTokenStore)
    assert isinstance(activation._accounts, SQLAlchemyAccountActivationRepository)
    assert activation._accounts._session_factory is sqlite_session_factory
    assert isinstance(activation._workspace_policy, DeploymentWorkspaceInvitePolicy)
    assert isinstance(activation._eligibility, BillingAccountActivationEligibility)
    assert activation._eligibility._enabled is billing_enabled
    assert isinstance(activation._membership_cache, BillingWorkspaceMembershipCache)
    assert activation._membership_cache._enabled is billing_enabled
    assert isinstance(activation._member_access_sync, RBACWorkspaceMemberAccessSync)


def test_build_application_services_wires_data_source_api_key_auth(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    assert isinstance(services.data_source_api_key_auth, DataSourceApiKeyAuthService)


def test_build_application_services_uses_supplied_redis_for_both_workflow_stop_signals(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    redis = _StopRedis(read_error=AssertionError("Workflow stop must not inspect task ownership"))
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis,
    )

    services.app_tasks.stop_workflow_task_no_user_check(task_id="workflow-task")

    assert redis.reads == []
    assert redis.operations == ["legacy_flag", "graph_command"]
    assert redis.values["generate_task_stopped:workflow-task"] == b"1"
    assert redis.expirations["generate_task_stopped:workflow-task"] == 600
    assert [json.loads(command) for command in redis.commands["workflow:workflow-task:commands"]] == [
        {"command_type": "abort", "payload": None, "reason": "User requested stop"}
    ]
    assert redis.expirations["workflow:workflow-task:commands"] == 3600


def test_build_application_services_wires_trial_app_usage(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )
    app_id = str(uuid4())
    account_id = str(uuid4())

    services.trial_app_usage.record(app_id=app_id, account_id=account_id)

    with sqlite_session_factory() as session:
        record = session.scalar(
            select(AccountTrialAppRecord).where(
                AccountTrialAppRecord.app_id == app_id,
                AccountTrialAppRecord.account_id == account_id,
            )
        )
    assert record is not None
    assert record.count == 1


@pytest.fixture
def installed_app_ref(sqlite_session_factory: sessionmaker[Session]) -> InstalledAppRef:
    with sqlite_session_factory.begin() as session:
        app = App(
            tenant_id=str(uuid4()),
            name="Installed app",
            mode=AppMode.COMPLETION,
            enable_site=True,
            enable_api=True,
        )
        session.add(app)
        session.flush()
        installed_app = InstalledApp(
            tenant_id=str(uuid4()),
            app_id=app.id,
            app_owner_tenant_id=app.tenant_id,
            is_pinned=False,
        )
        session.add(installed_app)
        session.flush()
        result = InstalledAppRef(id=installed_app.id, app_id=app.id, tenant_id=installed_app.tenant_id)
    return result


@pytest.mark.parametrize(
    ("deployment_edition", "permission_result"),
    [
        pytest.param(DeploymentEdition.COMMUNITY, False, id="community-skips-permission"),
        pytest.param(DeploymentEdition.CLOUD, False, id="cloud-skips-permission"),
        pytest.param(DeploymentEdition.ENTERPRISE, True, id="enterprise-allowed"),
        pytest.param(DeploymentEdition.ENTERPRISE, False, id="enterprise-denied"),
    ],
)
def test_build_application_services_wires_installed_app_admission(
    sqlite_session_factory: sessionmaker[Session],
    installed_app_ref: InstalledAppRef,
    deployment_edition: DeploymentEdition,
    permission_result: bool,
) -> None:
    account_id = str(uuid4())
    with patch(
        "services.enterprise.enterprise_service.EnterpriseRequest.send_request",
        return_value={"result": permission_result},
    ) as enterprise_request:
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=deployment_edition,
            initialization_password="",
            redis=MagicMock(spec=RedisClientWrapper),
        )
        if deployment_edition == DeploymentEdition.ENTERPRISE and not permission_result:
            with pytest.raises(InstalledAppAccessDeniedError):
                services.installed_app_access.get_access(
                    installed_app_id=installed_app_ref.id,
                    tenant_id=installed_app_ref.tenant_id,
                    account_id=account_id,
                )
        else:
            assert (
                services.installed_app_access.get_access(
                    installed_app_id=installed_app_ref.id,
                    tenant_id=installed_app_ref.tenant_id,
                    account_id=account_id,
                )
                == installed_app_ref
            )

    if deployment_edition == DeploymentEdition.ENTERPRISE:
        enterprise_request.assert_called_once_with(
            "GET", "/webapp/permission", params={"userId": account_id, "appId": installed_app_ref.app_id}
        )
    else:
        enterprise_request.assert_not_called()


@pytest.mark.parametrize(
    "enterprise_error",
    [
        pytest.param(EnterpriseAPINotFoundError(), id="not-found"),
        pytest.param(EnterpriseAPIError("permission unavailable"), id="api-error"),
        pytest.param(httpx.ConnectError("connection failed"), id="transport"),
        pytest.param(json.JSONDecodeError("invalid", "", 0), id="invalid-json"),
        pytest.param(UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid"), id="invalid-encoding"),
    ],
)
def test_installed_app_admission_normalizes_known_enterprise_errors(
    sqlite_session_factory: sessionmaker[Session],
    installed_app_ref: InstalledAppRef,
    enterprise_error: Exception,
) -> None:
    account_id = str(uuid4())
    with patch(
        "services.enterprise.enterprise_service.EnterpriseRequest.send_request",
        side_effect=enterprise_error,
    ) as enterprise_request:
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.ENTERPRISE,
            initialization_password="",
            redis=MagicMock(spec=RedisClientWrapper),
        )
        with pytest.raises(WebAppAccessUnavailableError) as raised:
            services.installed_app_access.get_access(
                installed_app_id=installed_app_ref.id,
                tenant_id=installed_app_ref.tenant_id,
                account_id=account_id,
            )

    assert raised.value.__cause__ is enterprise_error
    enterprise_request.assert_called_once_with(
        "GET", "/webapp/permission", params={"userId": account_id, "appId": installed_app_ref.app_id}
    )


def test_build_application_services_adapts_enterprise_webapp_access_mode(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with (
        patch("extensions.ext_application_services.SystemFeatureService.is_webapp_auth_enabled", return_value=True),
        patch(
            "extensions.ext_application_services.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
            return_value=SimpleNamespace(access_mode="private_all"),
        ) as get_access_mode,
    ):
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=MagicMock(spec=RedisClientWrapper),
        )
        result = services.webapp_access.get_access_mode(app_id="app-1", app_code=None)

    assert result is WebAppAccessMode.PRIVATE_ALL
    get_access_mode.assert_called_once_with("app-1")


def _query_webapp_access(
    service: WebAppAccessQueryService, query_kind: str
) -> WebAppAccessMode | bool | Mapping[str, WebAppAccessMode] | Mapping[str, bool]:
    if query_kind == "single-mode":
        return service.get_access_mode(app_id="app-1", app_code=None)
    if query_kind == "single-permission":
        return service.is_user_allowed(user_id="viewer", app_id="app-1")
    if query_kind == "batch-modes":
        return service.batch_get_access_modes(app_ids=("app-1",))
    assert query_kind == "batch-permissions"
    return service.batch_get_user_permissions(user_id="viewer", app_ids=("app-1",))


@pytest.mark.parametrize("query_kind", ["single-mode", "single-permission", "batch-modes", "batch-permissions"])
@pytest.mark.parametrize(
    "enterprise_error",
    [
        pytest.param(httpx.ReadTimeout("Enterprise timed out"), id="timeout"),
        pytest.param(httpx.ConnectError("connection failed"), id="connection"),
        pytest.param(EnterpriseServiceError("upstream failure"), id="upstream"),
        pytest.param(json.JSONDecodeError("invalid", "", 0), id="invalid-json"),
        pytest.param(UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid"), id="invalid-encoding"),
    ],
)
def test_webapp_access_queries_map_known_enterprise_errors_to_unavailable(
    sqlite_session_factory: sessionmaker[Session],
    query_kind: str,
    enterprise_error: Exception,
) -> None:
    with patch(
        "services.enterprise.enterprise_service.EnterpriseRequest.send_request", side_effect=enterprise_error
    ) as enterprise_request:
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.ENTERPRISE,
            initialization_password="",
            redis=_StopRedis(),
        )
        with pytest.raises(WebAppAccessUnavailableError) as raised:
            _query_webapp_access(services.webapp_access, query_kind)

    assert type(raised.value) is WebAppAccessUnavailableError
    assert raised.value.__cause__ is enterprise_error
    assert enterprise_request.call_count == 1


@pytest.mark.parametrize("access_mode", ["invalid", 123])
def test_single_webapp_mode_maps_invalid_enum_or_field_value_to_unavailable(
    sqlite_session_factory: sessionmaker[Session], access_mode: str | int
) -> None:
    with patch(
        "services.enterprise.enterprise_service.EnterpriseRequest.send_request",
        return_value={"accessMode": access_mode},
    ):
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.ENTERPRISE,
            initialization_password="",
            redis=_StopRedis(),
        )
        with pytest.raises(WebAppAccessUnavailableError) as raised:
            services.webapp_access.get_access_mode(app_id="app-1", app_code=None)

    assert type(raised.value) is WebAppAccessUnavailableError
    assert isinstance(raised.value.__cause__, ValueError)


@pytest.mark.parametrize("query_kind", ["single-mode", "single-permission", "batch-modes", "batch-permissions"])
@pytest.mark.parametrize("failure", [TypeError("adapter bug"), ValueError("unexpected programming error")])
def test_webapp_access_queries_do_not_hide_unknown_programming_errors(
    sqlite_session_factory: sessionmaker[Session], query_kind: str, failure: Exception
) -> None:
    with patch("services.enterprise.enterprise_service.EnterpriseRequest.send_request", side_effect=failure):
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.ENTERPRISE,
            initialization_password="",
            redis=_StopRedis(),
        )
        with pytest.raises(type(failure)) as raised:
            _query_webapp_access(services.webapp_access, query_kind)

    assert raised.value is failure


def test_build_application_services_wires_webapp_permission(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with (
        patch(
            "extensions.ext_application_services.SystemFeatureService.is_webapp_auth_enabled", return_value=True
        ) as enabled,
        patch(
            "extensions.ext_application_services.EnterpriseService.WebAppAuth.get_app_access_mode_by_id",
            return_value=SimpleNamespace(access_mode="private"),
        ) as get_access_mode,
        patch(
            "extensions.ext_application_services.EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp",
            return_value=False,
        ) as is_user_allowed,
    ):
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=MagicMock(spec=RedisClientWrapper),
        )
        requires_permission = services.webapp_access.requires_permission_check("app-1")
        allowed = services.webapp_access.is_user_allowed(user_id="user-1", app_id="app-1")

    assert requires_permission is True
    assert allowed is False
    enabled.assert_has_calls(
        [
            call(deployment_edition=DeploymentEdition.COMMUNITY),
            call(deployment_edition=DeploymentEdition.COMMUNITY),
        ]
    )
    get_access_mode.assert_called_once_with("app-1")
    is_user_allowed.assert_called_once_with("user-1", "app-1")


def test_webapp_permission_adapter_maps_connection_failure() -> None:
    failure = httpx.ConnectError("connection failed")
    with (
        patch(
            "extensions.ext_application_services.EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp",
            side_effect=failure,
        ),
        pytest.raises(WebAppAccessUnavailableError) as raised,
    ):
        ext_application_services._is_enterprise_webapp_user_allowed("user-1", "app-1")

    assert raised.value.__cause__ is failure


def test_build_application_services_wires_dynamic_recommended_catalog(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_config_overrides(monkeypatch, HOSTED_FETCH_APP_TEMPLATES_MODE="builtin")
    services = ext_application_services.build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    )

    builtin_payload = json.dumps(
        {
            "recommended_apps": {
                "en-US": {
                    "recommended_apps": [{"app": None, "app_id": "app-1", "categories": []}],
                    "categories": [],
                }
            }
        }
    )
    with patch.object(recommended_app_catalog_gateway.Path, "read_text", return_value=builtin_payload):
        result = services.recommended_app_queries.list_recommended(
            language="en-US",
        )
    assert result.recommended_apps

    apply_config_overrides(monkeypatch, HOSTED_FETCH_APP_TEMPLATES_MODE="invalid")
    with pytest.raises(ValueError, match="invalid fetch recommended apps mode: invalid"):
        services.recommended_app_queries.list_recommended(
            language="en-US",
        )


@pytest.mark.parametrize(
    ("deployment_edition", "permission_result"),
    [
        pytest.param(DeploymentEdition.COMMUNITY, False, id="community-skips-enterprise"),
        pytest.param(DeploymentEdition.CLOUD, False, id="cloud-skips-enterprise"),
        pytest.param(DeploymentEdition.ENTERPRISE, True, id="enterprise-allowed"),
        pytest.param(DeploymentEdition.ENTERPRISE, False, id="enterprise-denied"),
    ],
)
def test_installed_app_management_composition_reads_real_installations_and_current_workspace_role(
    sqlite_session_factory: sessionmaker[Session],
    installed_app_ref: InstalledAppRef,
    deployment_edition: DeploymentEdition,
    permission_result: bool,
) -> None:
    account_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        account = Account(name="Viewer", email="management@example.com")
        account.id = account_id
        tenant = Tenant(name="Viewer workspace")
        tenant.id = installed_app_ref.tenant_id
        session.add_all([account, tenant])
        membership = TenantAccountJoin(
            tenant_id=installed_app_ref.tenant_id, account_id=account_id, role=TenantAccountRole.OWNER
        )
        configuration = AppModelConfig(app_id=installed_app_ref.app_id)
        session.add_all([membership, configuration])
        session.flush()
        app = session.get(App, installed_app_ref.app_id)
        assert app is not None
        app.app_model_config_id = configuration.id
        membership_id = membership.id

    active_connections = 0
    engine = sqlite_session_factory.kw["bind"]

    @event.listens_for(engine, "checkout")
    def connection_checked_out(_connection: object, _record: object, _proxy: object) -> None:
        nonlocal active_connections
        active_connections += 1

    @event.listens_for(engine, "checkin")
    def connection_checked_in(_connection: object, _record: object) -> None:
        nonlocal active_connections
        active_connections -= 1

    def enterprise_response(method: str, path: str, *, json: dict[str, object]) -> dict[str, object]:
        assert deployment_edition == DeploymentEdition.ENTERPRISE
        # The candidate read must release its DB connection before either network call.
        assert active_connections == 0
        assert method == "POST"
        if path == "/webapp/access-mode/batch/id":
            assert json == {"appIds": [installed_app_ref.app_id]}
            return {"accessModes": {installed_app_ref.app_id: "private"}}
        assert path == "/webapp/permission/batch"
        assert json == {"userId": account_id, "appIds": [installed_app_ref.app_id]}
        return {"permissions": {installed_app_ref.app_id: permission_result}}

    with patch(
        "services.enterprise.enterprise_service.EnterpriseRequest.send_request", side_effect=enterprise_response
    ) as enterprise_request:
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=deployment_edition,
            initialization_password="",
            redis=_StopRedis(),
        )
        if deployment_edition != DeploymentEdition.ENTERPRISE:
            assert services.webapp_access.batch_get_access_modes(app_ids=(installed_app_ref.app_id,)) == {
                installed_app_ref.app_id: WebAppAccessMode.PUBLIC
            }
            assert services.webapp_access.batch_get_user_permissions(
                user_id=account_id, app_ids=(installed_app_ref.app_id,)
            ) == {installed_app_ref.app_id: True}
            assert services.installed_app_access.get_visible_app_ids(
                user_id=account_id, app_ids=(installed_app_ref.app_id,)
            ) == frozenset({installed_app_ref.app_id})
        page = services.installed_apps.get_visible_page(
            tenant_id=installed_app_ref.tenant_id,
            user_id=account_id,
            cursor=None,
            limit=1,
            app_id=None,
            name=None,
        )
        assert page.editable is True
        assert page.has_more is False
        assert page.next_cursor is None
        expected_ids: list[str] = (
            [installed_app_ref.id] if deployment_edition != DeploymentEdition.ENTERPRISE or permission_result else []
        )
        assert [installation.id for installation in page.data] == expected_ids

        with sqlite_session_factory.begin() as session:
            stored_membership = session.get(TenantAccountJoin, membership_id)
            assert stored_membership is not None
            stored_membership.role = TenantAccountRole.NORMAL
        services.installed_apps.set_pinned(installed_app=installed_app_ref, is_pinned=True)
        detail = services.installed_apps.get_detail(installed_app=installed_app_ref, account_id=account_id)
        assert detail.editable is False
        assert detail.installation.is_pinned is True
        assert detail.installation.id == installed_app_ref.id
        assert detail.installation.app.id == installed_app_ref.app_id
        assert active_connections == 0

    if deployment_edition == DeploymentEdition.ENTERPRISE:
        assert enterprise_request.call_args_list == [
            call("POST", "/webapp/access-mode/batch/id", json={"appIds": [installed_app_ref.app_id]}),
            call(
                "POST",
                "/webapp/permission/batch",
                json={"userId": account_id, "appIds": [installed_app_ref.app_id]},
            ),
        ]
    else:
        enterprise_request.assert_not_called()


def test_installed_app_visibility_batches_settings_before_permissions_and_preserves_truthiness_filter(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app_ids = (
        "allowed",
        "truthy-permission",
        "missing-setting",
        "sso",
        "denied",
        "zero",
        "empty",
        "null",
        "missing-permission",
    )
    permission_candidates = ["allowed", "truthy-permission", "denied", "zero", "empty", "null", "missing-permission"]
    with patch(
        "services.enterprise.enterprise_service.EnterpriseRequest.send_request",
        side_effect=[
            {
                "accessModes": {
                    "allowed": "private",
                    "truthy-permission": "private_all",
                    "sso": "sso_verified",
                    "denied": "public",
                    "zero": "private_all",
                    "empty": "public",
                    "null": "private",
                    "missing-permission": "private",
                }
            },
            {
                "permissions": {
                    "allowed": True,
                    "truthy-permission": 1,
                    "missing-setting": True,
                    "sso": True,
                    "denied": False,
                    "zero": 0,
                    "empty": "",
                    "null": None,
                }
            },
        ],
    ) as enterprise_request:
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.ENTERPRISE,
            initialization_password="",
            redis=_StopRedis(),
        )
        visible = services.installed_app_access.get_visible_app_ids(user_id="viewer", app_ids=app_ids)

    assert visible == frozenset({"allowed", "truthy-permission"})
    assert enterprise_request.call_args_list == [
        call("POST", "/webapp/access-mode/batch/id", json={"appIds": list(app_ids)}),
        call("POST", "/webapp/permission/batch", json={"userId": "viewer", "appIds": permission_candidates}),
    ]


@pytest.mark.parametrize("include_valid_apps", [True, False], ids=["mixed-modes", "all-invalid"])
def test_installed_app_visibility_skips_and_logs_each_invalid_access_mode(
    sqlite_session_factory: sessionmaker[Session], caplog: pytest.LogCaptureFixture, include_valid_apps: bool
) -> None:
    modes = {"invalid-empty": "", "invalid-unknown": "future-mode"}
    valid_ids: list[str] = ["valid-before", "valid-after"] if include_valid_apps else []
    if include_valid_apps:
        modes = {"valid-before": "private", **modes, "valid-after": "public"}
    app_ids = tuple(modes)
    responses: list[object] = [{"accessModes": modes}]
    if include_valid_apps:
        # Even an over-inclusive permission response must not restore invalid apps.
        responses.append({"permissions": dict.fromkeys(app_ids, True)})
    with patch(
        "services.enterprise.enterprise_service.EnterpriseRequest.send_request", side_effect=responses
    ) as enterprise_request:
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.ENTERPRISE,
            initialization_password="",
            redis=_StopRedis(),
        )
        visible = services.installed_app_access.get_visible_app_ids(user_id="viewer", app_ids=app_ids)

    assert visible == frozenset(valid_ids)
    expected_calls = [call("POST", "/webapp/access-mode/batch/id", json={"appIds": list(app_ids)})]
    if include_valid_apps:
        expected_calls.append(call("POST", "/webapp/permission/batch", json={"userId": "viewer", "appIds": valid_ids}))
    assert enterprise_request.call_args_list == expected_calls
    warnings = [
        message
        for logger_name, level, message in caplog.record_tuples
        if logger_name == ext_application_services.__name__ and level == logging.WARNING
    ]
    assert len(warnings) == 2
    assert any("invalid-empty" in message and repr("") in message for message in warnings)
    assert any("invalid-unknown" in message and repr("future-mode") in message for message in warnings)


@pytest.mark.parametrize("app_ids", [(), ("sso", "missing")])
def test_installed_app_visibility_skips_unnecessary_enterprise_requests(
    sqlite_session_factory: sessionmaker[Session], app_ids: tuple[str, ...]
) -> None:
    with patch(
        "services.enterprise.enterprise_service.EnterpriseRequest.send_request",
        return_value={"accessModes": {"sso": "sso_verified"}},
    ) as enterprise_request:
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.ENTERPRISE,
            initialization_password="",
            redis=_StopRedis(),
        )
        visible = services.installed_app_access.get_visible_app_ids(user_id="viewer", app_ids=app_ids)

    assert visible == frozenset()
    if app_ids:
        enterprise_request.assert_called_once_with(
            "POST", "/webapp/access-mode/batch/id", json={"appIds": list(app_ids)}
        )
    else:
        enterprise_request.assert_not_called()


@pytest.mark.parametrize("failure_stage", ["settings", "permissions"])
def test_installed_app_visibility_propagates_access_unavailable_with_original_cause(
    sqlite_session_factory: sessionmaker[Session],
    failure_stage: str,
) -> None:
    enterprise_error = EnterpriseAPIError("batch unavailable")
    responses: list[object] = []
    if failure_stage == "permissions":
        responses.append({"accessModes": {"app-1": "private"}})
    responses.append(enterprise_error)
    with patch(
        "services.enterprise.enterprise_service.EnterpriseRequest.send_request", side_effect=responses
    ) as enterprise_request:
        services = ext_application_services.build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.ENTERPRISE,
            initialization_password="",
            redis=_StopRedis(),
        )
        with pytest.raises(WebAppAccessUnavailableError) as caught:
            services.installed_app_access.get_visible_app_ids(user_id="viewer", app_ids=("app-1",))

    assert type(caught.value) is WebAppAccessUnavailableError
    assert caught.value.__cause__ is enterprise_error
    assert enterprise_request.call_count == (2 if failure_stage == "permissions" else 1)

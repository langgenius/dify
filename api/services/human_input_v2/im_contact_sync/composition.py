"""Production composition for transport-neutral IM Contact synchronization."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.helper import encrypter
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import IMIntegration
from core.human_input_v2.im_integration.adapters.dingtalk import DingTalkIMProviderAdapter
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMIntegrationCredentials,
    FeishuIMProviderAdapter,
    LarkIMIntegrationCredentials,
    LarkIMProviderAdapter,
)
from core.human_input_v2.im_integration.adapters.ms_teams import MSTeamsIMProviderAdapter
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter
from core.human_input_v2.im_integration.adapters.wecom import WeComIMProviderAdapter
from core.human_input_v2.im_provider import (
    DingTalkIMIntegrationCredentials,
    IMDirectory,
    MSTeamsIMIntegrationCredentials,
    SlackIMIntegrationCredentials,
    WeComIMIntegrationCredentials,
)
from core.human_input_v2.shared import DeploymentScope, DirectoryScope, IMSyncRunId, WorkspaceScope
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.human_input_v2 import (
    DingTalkIMIntegrationEncryptedCredentials,
    FeishuIMIntegrationEncryptedCredentials,
    LarkIMIntegrationEncryptedCredentials,
    MSTeamsIMIntegrationEncryptedCredentials,
    SlackIMIntegrationEncryptedCredentials,
    WeComIMIntegrationEncryptedCredentials,
)
from models.model import DifySetup
from repositories.human_input_v2.im_integration import (
    SQLAlchemyIMControlPlaneRepository,
    SQLAlchemyOrganizationIMWriteUnitOfWork,
)

from .binding_service import ContactIMBindingService
from .coordinator import IMContactSyncCoordinator
from .locking import OrganizationIMWriteLock, OrganizationIMWriteScope
from .service import IMSyncService
from .worker import IMContactSyncWorker

_IM_WRITE_LOCK_ACQUISITION_TIMEOUT_SECONDS = 5.0
_IM_WRITE_LOCK_LEASE_SECONDS = 30.0


class _IMContactSyncAdapter(Protocol):
    @property
    def directory(self) -> IMDirectory: ...

    def close(self) -> None: ...


@dataclass(frozen=True, slots=True)
class IMContactSyncApplication:
    """Transport-neutral application services composed over one persistence boundary."""

    sync_service: IMSyncService
    binding_service: ContactIMBindingService
    worker: IMContactSyncWorker


class DifyIMProviderAdapterFactory:
    """Reveal owner-bound credentials and construct the captured Provider adapter."""

    def __init__(
        self,
        *,
        decrypt_token: Callable[[str, str], str] = encrypter.decrypt_token,
        deployment_owner_key_loader: Callable[[], str],
        slack_adapter_factory: Callable[[SlackIMIntegrationCredentials], _IMContactSyncAdapter] = (
            SlackIMProviderAdapter
        ),
        feishu_adapter_factory: Callable[[FeishuIMIntegrationCredentials], _IMContactSyncAdapter] = (
            FeishuIMProviderAdapter
        ),
        lark_adapter_factory: Callable[[LarkIMIntegrationCredentials], _IMContactSyncAdapter] = LarkIMProviderAdapter,
        dingtalk_adapter_factory: Callable[[DingTalkIMIntegrationCredentials], _IMContactSyncAdapter] = (
            DingTalkIMProviderAdapter
        ),
        ms_teams_adapter_factory: Callable[[MSTeamsIMIntegrationCredentials], _IMContactSyncAdapter] = (
            MSTeamsIMProviderAdapter
        ),
        wecom_adapter_factory: Callable[[WeComIMIntegrationCredentials], _IMContactSyncAdapter] = (
            WeComIMProviderAdapter
        ),
    ) -> None:
        self._decrypt_token = decrypt_token
        self._deployment_owner_key_loader = deployment_owner_key_loader
        self._slack_adapter_factory = slack_adapter_factory
        self._feishu_adapter_factory = feishu_adapter_factory
        self._lark_adapter_factory = lark_adapter_factory
        self._dingtalk_adapter_factory = dingtalk_adapter_factory
        self._ms_teams_adapter_factory = ms_teams_adapter_factory
        self._wecom_adapter_factory = wecom_adapter_factory

    def __call__(self, integration: IMIntegration) -> _IMContactSyncAdapter:
        owner_key = (
            str(integration.tenant_id) if integration.tenant_id is not None else self._deployment_owner_key_loader()
        )
        provider = integration.provider_tenant.provider
        encrypted_values = integration.encrypted_credentials.to_mapping()
        if provider is IMProvider.SLACK:
            slack_credentials = SlackIMIntegrationEncryptedCredentials.model_validate(
                {"provider": provider, **encrypted_values}
            )
            return self._slack_adapter_factory(
                SlackIMIntegrationCredentials(
                    provider=provider,
                    client_id=slack_credentials.client_id,
                    client_secret=self._decrypt_token(owner_key, slack_credentials.encrypted_client_secret),
                    signing_secret=self._decrypt_token(owner_key, slack_credentials.encrypted_signing_secret),
                    bot_token=self._decrypt_token(owner_key, slack_credentials.encrypted_bot_token),
                    app_token=self._decrypt_optional(owner_key, slack_credentials.encrypted_app_token),
                )
            )
        if provider is IMProvider.FEISHU:
            feishu_credentials = FeishuIMIntegrationEncryptedCredentials.model_validate(
                {"provider": provider, **encrypted_values}
            )
            return self._feishu_adapter_factory(
                FeishuIMIntegrationCredentials(
                    provider=provider,
                    app_id=feishu_credentials.app_id,
                    app_secret=self._decrypt_token(owner_key, feishu_credentials.encrypted_app_secret),
                    verification_token=self._decrypt_optional(
                        owner_key, feishu_credentials.encrypted_verification_token
                    ),
                    encrypt_key=self._decrypt_optional(owner_key, feishu_credentials.encrypted_encrypt_key),
                )
            )
        if provider is IMProvider.LARK:
            lark_credentials = LarkIMIntegrationEncryptedCredentials.model_validate(
                {"provider": provider, **encrypted_values}
            )
            return self._lark_adapter_factory(
                LarkIMIntegrationCredentials(
                    provider=provider,
                    app_id=lark_credentials.app_id,
                    app_secret=self._decrypt_token(owner_key, lark_credentials.encrypted_app_secret),
                    verification_token=self._decrypt_optional(owner_key, lark_credentials.encrypted_verification_token),
                    encrypt_key=self._decrypt_optional(owner_key, lark_credentials.encrypted_encrypt_key),
                )
            )
        if provider is IMProvider.DING_TALK:
            dingtalk_credentials = DingTalkIMIntegrationEncryptedCredentials.model_validate(
                {"provider": provider, **encrypted_values}
            )
            return self._dingtalk_adapter_factory(
                DingTalkIMIntegrationCredentials(
                    provider=provider,
                    corp_id=dingtalk_credentials.corp_id,
                    client_id=dingtalk_credentials.client_id,
                    client_secret=self._decrypt_token(owner_key, dingtalk_credentials.encrypted_client_secret),
                )
            )
        if provider is IMProvider.MS_TEAMS:
            ms_teams_credentials = MSTeamsIMIntegrationEncryptedCredentials.model_validate(
                {"provider": provider, **encrypted_values}
            )
            return self._ms_teams_adapter_factory(
                MSTeamsIMIntegrationCredentials(
                    provider=provider,
                    tenant_id=ms_teams_credentials.tenant_id,
                    client_id=ms_teams_credentials.client_id,
                    client_secret=self._decrypt_token(owner_key, ms_teams_credentials.encrypted_client_secret),
                )
            )
        if provider is IMProvider.WE_COM:
            wecom_credentials = WeComIMIntegrationEncryptedCredentials.model_validate(
                {"provider": provider, **encrypted_values}
            )
            return self._wecom_adapter_factory(
                WeComIMIntegrationCredentials(
                    provider=provider,
                    corp_id=wecom_credentials.corp_id,
                    agent_id=wecom_credentials.agent_id,
                    secret=self._decrypt_token(owner_key, wecom_credentials.encrypted_secret),
                )
            )
        raise ValueError("unsupported IM Provider adapter")

    def _decrypt_optional(self, owner_key: str, encrypted_value: str | None) -> str | None:
        if encrypted_value is None:
            return None
        return self._decrypt_token(owner_key, encrypted_value)


def build_im_contact_sync_worker(
    *,
    session_maker: sessionmaker[Session] | None = None,
    adapter_factory: Callable[[IMIntegration], _IMContactSyncAdapter] | None = None,
) -> IMContactSyncWorker:
    sessions = session_maker or sessionmaker(bind=db.engine, expire_on_commit=False)
    write_unit_of_work_factory = _write_unit_of_work_factory(sessions)
    repository = SQLAlchemyIMControlPlaneRepository(sessions, write_unit_of_work_factory)
    resolved_adapter_factory = adapter_factory or DifyIMProviderAdapterFactory(
        deployment_owner_key_loader=lambda: _load_deployment_owner_key(sessions)
    )
    coordinator = IMContactSyncCoordinator(repository, resolved_adapter_factory, write_unit_of_work_factory)
    return IMContactSyncWorker(repository, coordinator)


def build_im_contact_sync_application(
    *,
    session_maker: sessionmaker[Session] | None = None,
    adapter_factory: Callable[[IMIntegration], _IMContactSyncAdapter] | None = None,
) -> IMContactSyncApplication:
    """Compose commands, queries, and worker orchestration without transport dependencies."""

    sessions = session_maker or sessionmaker(bind=db.engine, expire_on_commit=False)
    write_unit_of_work_factory = _write_unit_of_work_factory(sessions)
    repository = SQLAlchemyIMControlPlaneRepository(sessions, write_unit_of_work_factory)
    resolved_adapter_factory = adapter_factory or DifyIMProviderAdapterFactory(
        deployment_owner_key_loader=lambda: _load_deployment_owner_key(sessions)
    )
    coordinator = IMContactSyncCoordinator(repository, resolved_adapter_factory, write_unit_of_work_factory)

    def dispatch(sync_run_id: IMSyncRunId, scope: DirectoryScope) -> None:
        from tasks.im_contact_sync_tasks import reconcile_im_contacts_task

        scope_kind, tenant_id = _scope_payload(scope)
        reconcile_im_contacts_task.apply_async(
            args=(str(sync_run_id), scope_kind, tenant_id),
            queue="human_input_contact_sync",
        )

    return IMContactSyncApplication(
        sync_service=IMSyncService(repository, dispatch),
        binding_service=ContactIMBindingService(write_unit_of_work_factory),
        worker=IMContactSyncWorker(repository, coordinator),
    )


def build_im_sync_service(
    *,
    session_maker: sessionmaker[Session] | None = None,
) -> IMSyncService:
    sessions = session_maker or sessionmaker(bind=db.engine, expire_on_commit=False)
    repository = SQLAlchemyIMControlPlaneRepository(sessions, _write_unit_of_work_factory(sessions))

    def dispatch(sync_run_id: IMSyncRunId, scope: DirectoryScope) -> None:
        from tasks.im_contact_sync_tasks import reconcile_im_contacts_task

        scope_kind, tenant_id = _scope_payload(scope)
        reconcile_im_contacts_task.apply_async(
            args=(str(sync_run_id), scope_kind, tenant_id),
            queue="human_input_contact_sync",
        )

    return IMSyncService(repository, dispatch)


def _write_unit_of_work_factory(
    sessions: sessionmaker[Session],
) -> Callable[[DirectoryScope], SQLAlchemyOrganizationIMWriteUnitOfWork]:
    def create(scope: DirectoryScope) -> SQLAlchemyOrganizationIMWriteUnitOfWork:
        if isinstance(scope, WorkspaceScope):
            lock_scope = OrganizationIMWriteScope.for_workspace(scope.id)
        elif isinstance(scope, DeploymentScope):
            lock_scope = OrganizationIMWriteScope.for_deployment()
        else:
            raise TypeError("unsupported Organization write scope")
        write_lock = OrganizationIMWriteLock(
            redis_client,
            lock_scope,
            acquisition_timeout_seconds=_IM_WRITE_LOCK_ACQUISITION_TIMEOUT_SECONDS,
            lease_seconds=_IM_WRITE_LOCK_LEASE_SECONDS,
        )
        return SQLAlchemyOrganizationIMWriteUnitOfWork(sessions, write_lock)

    return create


def _load_deployment_owner_key(sessions: sessionmaker[Session]) -> str:
    with sessions() as session:
        instance_id = session.scalar(
            select(DifySetup.instance_id)
            .where(DifySetup.instance_id.is_not(None))
            .order_by(DifySetup.setup_at, DifySetup.version)
            .limit(1)
        )
    if instance_id is None:
        raise RuntimeError("deployment owner identity is unavailable")
    return instance_id


def _scope_payload(scope: DirectoryScope) -> tuple[str, str | None]:
    if isinstance(scope, WorkspaceScope):
        return "workspace", str(scope.id)
    if isinstance(scope, DeploymentScope):
        return "deployment", None
    raise TypeError("unsupported Organization write scope")


__all__ = [
    "DifyIMProviderAdapterFactory",
    "IMContactSyncApplication",
    "build_im_contact_sync_application",
    "build_im_contact_sync_worker",
    "build_im_sync_service",
]

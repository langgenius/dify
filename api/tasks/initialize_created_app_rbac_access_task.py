"""Initialize default RBAC access for existing workspace members after app creation."""

import logging
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass

from celery import shared_task
from sqlalchemy import select

from configs import dify_config
from extensions.ext_database import db
from models import Agent, App, Dataset, TenantAccountJoin, TenantAccountRole
from services.account_service import TenantService
from services.enterprise import rbac_service as enterprise_rbac_service

logger = logging.getLogger(__name__)

APP_RBAC_ACCOUNT_POLICY_BATCH_SIZE = 500
APP_RBAC_DEFAULT_ACCESS_POLICY_ID = "default"
APP_RBAC_QUEUE = "app_rbac"
APP_RBAC_RESOURCE_CONFIG_BATCH_SIZE = 500
APP_RBAC_MEMBER_APPEND_BATCH_SIZE = 500


def _owner_account_id(tenant_id: str) -> str | None:
    return db.session().scalar(
        select(TenantAccountJoin.account_id)
        .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.role == TenantAccountRole.OWNER)
        .order_by(TenantAccountJoin.id.asc())
        .limit(1)
    )


@dataclass(frozen=True)
class _WhitelistResourceKind[ItemT]:
    resource_type: enterprise_rbac_service.RBACResourceType
    model: type[App] | type[Dataset] | type[Agent]
    build_item: Callable[[str, str], ItemT]
    append_members: Callable[[str, str | None, Sequence[ItemT]], None]
    replace_user_access_policies: Callable[
        [str, str, str, enterprise_rbac_service.ReplaceUserAccessPolicies],
        enterprise_rbac_service.ReplaceUserAccessPoliciesResponse,
    ]

    def iter_id_batches(self, tenant_id: str, batch_size: int) -> Iterator[list[str]]:
        last_id: str | None = None
        while True:
            stmt = (
                select(self.model.id)
                .where(self.model.tenant_id == tenant_id)
                .order_by(self.model.id.asc())
                .limit(batch_size)
            )
            if last_id:
                stmt = stmt.where(self.model.id > last_id)
            ids = [str(resource_id) for resource_id in db.session().scalars(stmt).all()]
            if not ids:
                return
            yield ids
            last_id = ids[-1]

    def append_member(self, tenant_id: str, actor_account_id: str, resource_ids: list[str], member_account_id: str):
        self.append_members(
            tenant_id,
            actor_account_id,
            [self.build_item(resource_id, member_account_id) for resource_id in resource_ids],
        )


_WHITELIST_RESOURCE_KINDS = (
    _WhitelistResourceKind(
        resource_type=enterprise_rbac_service.RBACResourceType.APP,
        model=App,
        build_item=lambda app_id, member: enterprise_rbac_service.AppendAppWhitelistMembersBatchItem(
            app_id=app_id, account_ids=[member], policy_id=APP_RBAC_DEFAULT_ACCESS_POLICY_ID
        ),
        append_members=lambda tenant_id, account_id, data: (
            enterprise_rbac_service.RBACService.AppAccess.append_whitelist_members_batch(
                tenant_id=tenant_id, account_id=account_id, data=data
            )
        ),
        replace_user_access_policies=lambda tenant_id, account_id, resource_id, payload: (
            enterprise_rbac_service.RBACService.AppAccess.replace_user_access_policies(
                tenant_id=tenant_id,
                account_id=account_id,
                app_id=resource_id,
                target_account_id=None,
                payload=payload,
            )
        ),
    ),
    _WhitelistResourceKind(
        resource_type=enterprise_rbac_service.RBACResourceType.DATASET,
        model=Dataset,
        build_item=lambda dataset_id, member: enterprise_rbac_service.AppendDatasetWhitelistMembersBatchItem(
            dataset_id=dataset_id, account_ids=[member], policy_id=APP_RBAC_DEFAULT_ACCESS_POLICY_ID
        ),
        append_members=lambda tenant_id, account_id, data: (
            enterprise_rbac_service.RBACService.DatasetAccess.append_whitelist_members_batch(
                tenant_id=tenant_id, account_id=account_id, data=data
            )
        ),
        replace_user_access_policies=lambda tenant_id, account_id, resource_id, payload: (
            enterprise_rbac_service.RBACService.DatasetAccess.replace_user_access_policies(
                tenant_id=tenant_id,
                account_id=account_id,
                dataset_id=resource_id,
                target_account_id=None,
                payload=payload,
            )
        ),
    ),
    _WhitelistResourceKind(
        resource_type=enterprise_rbac_service.RBACResourceType.AGENT,
        model=Agent,
        build_item=lambda agent_id, member: enterprise_rbac_service.AppendAgentWhitelistMembersBatchItem(
            agent_id=agent_id, account_ids=[member], policy_id=APP_RBAC_DEFAULT_ACCESS_POLICY_ID
        ),
        append_members=lambda tenant_id, account_id, data: (
            enterprise_rbac_service.RBACService.AgentAccess.append_whitelist_members_batch(
                tenant_id=tenant_id, account_id=account_id, data=data
            )
        ),
        replace_user_access_policies=lambda tenant_id, account_id, resource_id, payload: (
            enterprise_rbac_service.RBACService.AgentAccess.replace_user_access_policies(
                tenant_id=tenant_id,
                account_id=account_id,
                agent_id=resource_id,
                target_account_id=None,
                payload=payload,
            )
        ),
    ),
)
_WHITELIST_RESOURCE_KIND_BY_TYPE = {kind.resource_type: kind for kind in _WHITELIST_RESOURCE_KINDS}


def _iter_resource_config_batches(
    tenant_id: str,
    batch_size: int,
) -> Iterator[list[enterprise_rbac_service.ResourceWhitelistConfigResource]]:
    for kind in _WHITELIST_RESOURCE_KINDS:
        for ids in kind.iter_id_batches(tenant_id, batch_size):
            yield [
                enterprise_rbac_service.ResourceWhitelistConfigResource(
                    resource_type=kind.resource_type, resource_id=resource_id
                )
                for resource_id in ids
            ]


def _chunks[T](items: list[T], chunk_size: int) -> Iterator[list[T]]:
    for index in range(0, len(items), chunk_size):
        yield items[index : index + chunk_size]


def _resolve_target_resource(
    resource_ids: dict[enterprise_rbac_service.RBACResourceType, str | None],
) -> tuple[_WhitelistResourceKind, str]:
    """Return the resource kind and id for the single id the caller supplied."""
    provided = [(resource_type, rid) for resource_type, rid in resource_ids.items() if rid is not None]
    if len(provided) != 1:
        given = ", ".join(sorted(resource_type.value for resource_type, _ in provided)) or "none"
        raise ValueError(f"exactly one of app_id, dataset_id, agent_id must be given, got: {given}")
    resource_type, resource_id = provided[0]
    return _WHITELIST_RESOURCE_KIND_BY_TYPE[resource_type], resource_id


@shared_task(queue=APP_RBAC_QUEUE, bind=True, max_retries=3, default_retry_delay=60)
def initialize_created_app_rbac_access_task(
    self,
    tenant_id: str,
    account_id: str,
    app_id: str | None = None,
    dataset_id: str | None = None,
    agent_id: str | None = None,
) -> None:
    """Grant the default access policy on one resource to current workspace members.

    Replacing member policies is idempotent, so retrying the whole synchronization is
    safe when the enterprise RBAC service is temporarily unavailable.
    """
    if not dify_config.RBAC_ENABLED:
        return

    kind, resource_id = _resolve_target_resource(
        {
            enterprise_rbac_service.RBACResourceType.APP: app_id,
            enterprise_rbac_service.RBACResourceType.DATASET: dataset_id,
            enterprise_rbac_service.RBACResourceType.AGENT: agent_id,
        }
    )

    try:
        for account_ids in TenantService.iter_member_account_id_batches(
            tenant_id,
            APP_RBAC_ACCOUNT_POLICY_BATCH_SIZE,
            session=db.session(),
        ):
            kind.replace_user_access_policies(
                tenant_id,
                account_id,
                resource_id,
                enterprise_rbac_service.ReplaceUserAccessPolicies(
                    access_policy_ids=[APP_RBAC_DEFAULT_ACCESS_POLICY_ID],
                    account_ids=account_ids,
                ),
            )
    except Exception as exc:
        logger.exception(
            "Failed to initialize RBAC access; retrying: tenant_id=%s resource_type=%s resource_id=%s attempt=%s",
            tenant_id,
            kind.resource_type.value,
            resource_id,
            self.request.retries + 1,
        )
        raise self.retry(exc=exc)


@shared_task(queue=APP_RBAC_QUEUE, bind=True, max_retries=3, default_retry_delay=60)
def sync_joined_workspace_member_rbac_access_task(
    self,
    tenant_id: str,
    member_account_id: str,
    operator_account_id: str | None = None,
) -> None:
    """Grant a newly joined member default access to resources that auto-include workspace members."""
    if not dify_config.RBAC_ENABLED:
        return

    try:
        actor_account_id = operator_account_id or _owner_account_id(tenant_id)
        if actor_account_id is None:
            logger.warning(
                "Skipping joined member RBAC access sync because workspace owner was not found: tenant_id=%s member=%s",
                tenant_id,
                member_account_id,
            )
            return

        auto_included: dict[enterprise_rbac_service.RBACResourceType, list[str]] = {
            kind.resource_type: [] for kind in _WHITELIST_RESOURCE_KINDS
        }
        for resources in _iter_resource_config_batches(tenant_id, APP_RBAC_RESOURCE_CONFIG_BATCH_SIZE):
            configs = enterprise_rbac_service.RBACService.ResourceWhitelistConfigs.batch_get(
                tenant_id=tenant_id,
                account_id=actor_account_id,
                resources=resources,
            )
            for config in configs.data:
                if not config.automatic_include_workspace_members:
                    continue
                ids = auto_included.get(config.resource_type)
                if ids is not None:
                    ids.append(config.resource_id)

        for resource_type, resource_ids in auto_included.items():
            kind = _WHITELIST_RESOURCE_KIND_BY_TYPE[resource_type]
            for id_batch in _chunks(resource_ids, APP_RBAC_MEMBER_APPEND_BATCH_SIZE):
                kind.append_member(tenant_id, actor_account_id, id_batch, member_account_id)
    except Exception as exc:
        logger.exception(
            "Failed to sync joined member RBAC access; retrying: tenant_id=%s member=%s attempt=%s",
            tenant_id,
            member_account_id,
            self.request.retries + 1,
        )
        raise self.retry(exc=exc)

"""Initialize default RBAC access for existing workspace members after app creation."""

import logging
from collections.abc import Iterator

from celery import shared_task
from sqlalchemy import select

from configs import dify_config
from extensions.ext_database import db
from models import App, Dataset, TenantAccountJoin, TenantAccountRole
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


def _iter_resource_config_batches(
    tenant_id: str,
    batch_size: int,
) -> Iterator[list[enterprise_rbac_service.ResourceWhitelistConfigResource]]:
    last_app_id: str | None = None
    while True:
        stmt = select(App.id).where(App.tenant_id == tenant_id).order_by(App.id.asc()).limit(batch_size)
        if last_app_id:
            stmt = stmt.where(App.id > last_app_id)
        app_ids = [str(app_id) for app_id in db.session().scalars(stmt).all()]
        if not app_ids:
            break
        yield [
            enterprise_rbac_service.ResourceWhitelistConfigResource(
                resource_type=enterprise_rbac_service.RBACResourceType.APP,
                resource_id=app_id,
            )
            for app_id in app_ids
        ]
        last_app_id = app_ids[-1]

    last_dataset_id: str | None = None
    while True:
        stmt = select(Dataset.id).where(Dataset.tenant_id == tenant_id).order_by(Dataset.id.asc()).limit(batch_size)
        if last_dataset_id:
            stmt = stmt.where(Dataset.id > last_dataset_id)
        dataset_ids = [str(dataset_id) for dataset_id in db.session().scalars(stmt).all()]
        if not dataset_ids:
            break
        yield [
            enterprise_rbac_service.ResourceWhitelistConfigResource(
                resource_type=enterprise_rbac_service.RBACResourceType.DATASET,
                resource_id=dataset_id,
            )
            for dataset_id in dataset_ids
        ]
        last_dataset_id = dataset_ids[-1]


def _chunks[T](items: list[T], chunk_size: int) -> Iterator[list[T]]:
    for index in range(0, len(items), chunk_size):
        yield items[index : index + chunk_size]


@shared_task(queue=APP_RBAC_QUEUE, bind=True, max_retries=3, default_retry_delay=60)
def initialize_created_app_rbac_access_task(
    self, tenant_id: str, account_id: str, app_id: str | None = None, dataset_id: str | None = None
) -> None:
    """Grant the default app policy to current workspace members.

    App scope is persisted synchronously before this task is queued. Replacing
    member policies is idempotent, so retrying the whole synchronization is safe
    when the enterprise RBAC service is temporarily unavailable.
    """
    if not dify_config.RBAC_ENABLED:
        return

    try:
        for account_ids in TenantService.iter_member_account_id_batches(
            tenant_id,
            APP_RBAC_ACCOUNT_POLICY_BATCH_SIZE,
            session=db.session(),
        ):
            if app_id is not None:
                enterprise_rbac_service.RBACService.AppAccess.replace_user_access_policies(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    app_id=app_id,
                    target_account_id=None,
                    payload=enterprise_rbac_service.ReplaceUserAccessPolicies(
                        access_policy_ids=[APP_RBAC_DEFAULT_ACCESS_POLICY_ID],
                        account_ids=account_ids,
                    ),
                )
            elif dataset_id is not None:
                enterprise_rbac_service.RBACService.DatasetAccess.replace_user_access_policies(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    dataset_id=dataset_id,
                    target_account_id=None,
                    payload=enterprise_rbac_service.ReplaceUserAccessPolicies(
                        access_policy_ids=[APP_RBAC_DEFAULT_ACCESS_POLICY_ID],
                        account_ids=account_ids,
                    ),
                )
    except Exception as exc:
        logger.exception(
            "Failed to initialize app RBAC access; retrying: tenant_id=%s app_id=%s attempt=%s",
            tenant_id,
            app_id,
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

        app_ids: list[str] = []
        dataset_ids: list[str] = []
        for resources in _iter_resource_config_batches(tenant_id, APP_RBAC_RESOURCE_CONFIG_BATCH_SIZE):
            configs = enterprise_rbac_service.RBACService.ResourceWhitelistConfigs.batch_get(
                tenant_id=tenant_id,
                account_id=actor_account_id,
                resources=resources,
            )
            for config in configs.data:
                if not config.automatic_include_workspace_members:
                    continue
                if config.resource_type == enterprise_rbac_service.RBACResourceType.APP:
                    app_ids.append(config.resource_id)
                elif config.resource_type == enterprise_rbac_service.RBACResourceType.DATASET:
                    dataset_ids.append(config.resource_id)

        for app_id_batch in _chunks(app_ids, APP_RBAC_MEMBER_APPEND_BATCH_SIZE):
            enterprise_rbac_service.RBACService.AppAccess.append_whitelist_members_batch(
                tenant_id=tenant_id,
                account_id=actor_account_id,
                data=[
                    enterprise_rbac_service.AppendAppWhitelistMembersBatchItem(
                        app_id=app_id,
                        account_ids=[member_account_id],
                        policy_id=APP_RBAC_DEFAULT_ACCESS_POLICY_ID,
                    )
                    for app_id in app_id_batch
                ],
            )

        for dataset_id_batch in _chunks(dataset_ids, APP_RBAC_MEMBER_APPEND_BATCH_SIZE):
            enterprise_rbac_service.RBACService.DatasetAccess.append_whitelist_members_batch(
                tenant_id=tenant_id,
                account_id=actor_account_id,
                data=[
                    enterprise_rbac_service.AppendDatasetWhitelistMembersBatchItem(
                        dataset_id=dataset_id,
                        account_ids=[member_account_id],
                        policy_id=APP_RBAC_DEFAULT_ACCESS_POLICY_ID,
                    )
                    for dataset_id in dataset_id_batch
                ],
            )
    except Exception as exc:
        logger.exception(
            "Failed to sync joined member RBAC access; retrying: tenant_id=%s member=%s attempt=%s",
            tenant_id,
            member_account_id,
            self.request.retries + 1,
        )
        raise self.retry(exc=exc)

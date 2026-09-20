"""Adapters for workspace plans, features, files, member roles, and provisioning."""

import logging
import secrets
from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager
from typing import Literal, override
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from enums import CloudPlan, DeploymentEdition
from events.tenant_event import tenant_was_created
from extensions.ext_redis import RedisClientWrapper
from libs.helper import RateLimiter, TokenManager
from libs.key_providers import generate_key_pair
from libs.workspace_permission import check_workspace_member_invite_permission
from machinery.context import RequestContext
from models.account import (
    Account,
    AccountStatus,
    Tenant,
    TenantAccountRole,
    TenantPluginAutoUpgradeCategory,
)
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.account.adapters import RedisInvitationTokenStore
from services.account_security_gateway import RedisAccountEmailSecurityGateway
from services.billing_service import BillingService
from services.credit_pool_service import CreditPoolBalance, CreditPoolService
from services.enterprise import rbac_service as enterprise_rbac_service
from services.enterprise.enterprise_service import EnterpriseService
from services.enterprise.rbac_service import ListOption, RBACService
from services.entities.account_activation_entities import InvitationToken
from services.entities.account_entities import AccountSnapshot
from services.errors.workspace import (
    InvalidWorkspaceMemberRoleError,
    OwnerTransferSendRateLimitError,
    WorkspaceInvitationQuotaError,
)
from services.feature_service import FeatureService
from services.file_service import FileService
from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService
from services.system_feature_service import SystemFeatureService
from services.workspace.contracts import (
    CreatedWorkspace,
    EffectiveCreditPool,
    OwnerTransferToken,
    WorkspaceCreation,
    WorkspaceFeatures,
    WorkspaceMemberRemoval,
    WorkspaceMemberRole,
    WorkspaceMemberRoleSubject,
    WorkspaceMemberWrite,
    WorkspacePermission,
)
from services.workspace.member_service import WorkspaceMemberRoleResolver
from services.workspace.service import WorkspaceFeatureGateway, WorkspaceLogoGateway, WorkspacePlanGateway
from tasks.mail_invite_member_task import send_invite_member_mail_task
from tasks.mail_owner_transfer_task import (
    send_new_owner_transfer_notify_email_task,
    send_old_owner_transfer_notify_email_task,
    send_owner_transfer_confirm_task,
)

logger = logging.getLogger(__name__)


class WorkspaceIdentityGateway:
    """Materialize workspace identities for adapters that require the ORM model."""

    def __init__(self, *, workspaces: WorkspaceRepository) -> None:
        self._workspaces = workspaces

    def get_workspace(self, workspace_id: str) -> Tenant | None:
        return self._workspaces.get_model(workspace_id)


class WorkspaceOwnerTransferGateway(RedisAccountEmailSecurityGateway):
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        super().__init__(
            redis=redis,
            email_send_ip_limit_per_minute=dify_config.EMAIL_SEND_IP_LIMIT_PER_MINUTE,
            verification_failure_limit=5,
            verification_lockout_duration=dify_config.OWNER_TRANSFER_LOCKOUT_DURATION,
            verification_key_prefix="owner_transfer_error_rate_limit",
        )
        self._send_limits = RateLimiter(
            prefix="owner_transfer_rate_limit", max_attempts=1, time_window=60, redis_client=redis
        )

    def send_confirmation(self, account: AccountSnapshot, workspace_name: str, language: str) -> str:
        if self._send_limits.is_rate_limited(account.email):
            raise OwnerTransferSendRateLimitError(int(self._send_limits.time_window / 60))
        code = "".join(str(secrets.randbelow(10)) for _ in range(6))
        token = self.issue_token(OwnerTransferToken(account.email, code, account.id))
        send_owner_transfer_confirm_task.delay(language=language, to=account.email, code=code, workspace=workspace_name)
        self._send_limits.increment_rate_limit(account.email)
        return token

    def read_token(self, token: str) -> OwnerTransferToken | None:
        data = TokenManager.get_token_data(token, "owner_transfer")
        if data is None or not isinstance(data.get("email"), str) or not isinstance(data.get("code"), str):
            return None
        return OwnerTransferToken(data["email"], data["code"], data.get("account_id"))

    def issue_token(self, token: OwnerTransferToken) -> str:
        return TokenManager.generate_token(
            account_id=token.account_id,
            email=token.email,
            token_type="owner_transfer",
            additional_data={"code": token.code},
        )

    def revoke_token(self, token: str) -> None:
        TokenManager.revoke_token(token, "owner_transfer")

    def notify(self, *, old_owner: AccountSnapshot, new_owner: AccountSnapshot, workspace_name: str) -> None:
        send_new_owner_transfer_notify_email_task.delay(language="en-US", to=new_owner.email, workspace=workspace_name)
        send_old_owner_transfer_notify_email_task.delay(
            language="en-US", to=old_owner.email, workspace=workspace_name, new_owner_email=new_owner.email
        )


class DeploymentWorkspaceCreationPolicy:
    def is_workspace_creation_allowed(self) -> bool:
        return SystemFeatureService.is_workspace_creation_allowed()

    def has_workspace_capacity(self) -> bool:
        return SystemFeatureService.get_license().workspaces.is_available()


def _ensure_role_enabled(role: str) -> None:
    if role == "dataset_operator" and not dify_config.DATASET_OPERATOR_ENABLED:
        raise InvalidWorkspaceMemberRoleError()


class WorkspaceInvitationGateway:
    def __init__(self, *, tokens: RedisInvitationTokenStore, redis: RedisClientWrapper) -> None:
        self._tokens = tokens
        self._redis = redis

    @property
    def requires_capacity_check(self) -> bool:
        return dify_config.DEPLOYMENT_EDITION in {DeploymentEdition.CLOUD, DeploymentEdition.ENTERPRISE}

    def acquire(self, workspace_id: str) -> AbstractContextManager[object]:
        return self._redis.lock(f"workspace_member_invite:{workspace_id}", timeout=60)

    def ensure_role_enabled(self, role: str) -> None:
        _ensure_role_enabled(role)

    def check_capacity(self, workspace_id: str, *, current_members: int, new_members: int, new_accounts: int) -> None:
        if dify_config.DEPLOYMENT_EDITION not in {DeploymentEdition.CLOUD, DeploymentEdition.ENTERPRISE}:
            return
        features = FeatureService.get_features(tenant_id=workspace_id, exclude_vector_space=True)
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE:
            quota = features.workspace_members
            if quota.enabled and not quota.is_available(new_members):
                raise WorkspaceInvitationQuotaError()
            if new_accounts and not SystemFeatureService.get_license().seats.is_available(new_accounts):
                raise WorkspaceInvitationQuotaError(seats=True)
        elif 0 < features.members.limit < current_members + new_members:
            raise WorkspaceInvitationQuotaError()

    def ensure_allowed(self, workspace_id: str) -> None:
        check_workspace_member_invite_permission(workspace_id)

    def create(self, invitation: InvitationToken) -> str:
        return self._tokens.create(invitation)

    def send(self, *, language: str, email: str, token: str, inviter_name: str, workspace_name: str) -> None:
        send_invite_member_mail_task.delay(
            language=language,
            to=email,
            token=token,
            inviter_name=inviter_name,
            workspace_name=workspace_name,
        )


class DeploymentWorkspaceMemberAccessGateway:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def ensure_role_enabled(self, role: str) -> None:
        _ensure_role_enabled(role)

    @property
    def rbac_enabled(self) -> bool:
        return dify_config.RBAC_ENABLED

    def permission_keys(self, workspace_id: str, actor_id: str) -> set[str]:
        with self._session_factory() as session:
            permissions = RBACService.MyPermissions.get(workspace_id, actor_id, session=session)
            return set(permissions.workspace.permission_keys)

    def is_owner(self, workspace_id: str, actor_id: str, member_id: str) -> bool:
        with self._session_factory() as session:
            roles = RBACService.MemberRoles.get(workspace_id, actor_id, member_id, session=session).roles
            return any(
                role.is_builtin and role.category == "global_system_default" and role.role_tag == "owner"
                for role in roles
            )

    @staticmethod
    def _role_id(workspace_id: str, actor_id: str, tag: str) -> str:
        roles = RBACService.Roles.list(
            workspace_id, actor_id, options=ListOption(page_number=1, results_per_page=100)
        ).data
        for role in roles:
            if role.is_builtin and role.category == "global_system_default" and role.role_tag == tag:
                return str(role.id)
        raise ValueError(f"Builtin RBAC role not found for tag {tag!r} in tenant {workspace_id}")

    def owner_id(self, workspace_id: str, actor_id: str) -> str:
        members = RBACService.Roles.members(
            tenant_id=workspace_id,
            account_id=actor_id,
            role_id=self._role_id(workspace_id, actor_id, "owner"),
            options=ListOption(page_number=1, results_per_page=1),
        ).data
        if not members:
            raise ValueError(f"Workspace RBAC owner not found for tenant {workspace_id}.")
        return members[0].account_id

    def assign_role(self, workspace_id: str, actor_id: str, member_id: str, role_id: str) -> None:
        with self._session_factory() as session:
            RBACService.MemberRoles.replace(
                tenant_id=workspace_id,
                account_id=actor_id,
                member_account_id=member_id,
                role_ids=[role_id],
                session=session,
            )
            session.commit()

    def change_role(self, workspace_id: str, actor_id: str, member_id: str, role: TenantAccountRole) -> None:
        if not TenantAccountRole.is_non_owner_role(role):
            raise InvalidWorkspaceMemberRoleError("Owner changes require ownership transfer.")
        self.assign_role(workspace_id, actor_id, member_id, self._role_id(workspace_id, actor_id, role.value))

    def transfer_owner(self, workspace_id: str, actor_id: str, member_id: str) -> None:
        owner_role_id = self._role_id(workspace_id, actor_id, "owner")
        old_owner_id = self.owner_id(workspace_id, actor_id)
        no_access_id = self._role_id(workspace_id, actor_id, "no_access")
        # With RBAC enabled these calls update the enterprise service, not the local
        # Session. Complete both before the repository commits local owner changes.
        with self._session_factory() as session:
            current = RBACService.MemberRoles.get(workspace_id, actor_id, old_owner_id, session=session).roles
            remaining = [str(item.id) for item in current if str(item.id) != owner_role_id]
            RBACService.MemberRoles.replace(
                tenant_id=workspace_id,
                account_id=actor_id,
                member_account_id=old_owner_id,
                role_ids=remaining or [no_access_id],
                session=session,
            )
            RBACService.MemberRoles.replace(
                tenant_id=workspace_id,
                account_id=actor_id,
                member_account_id=member_id,
                role_ids=[owner_role_id],
                session=session,
            )

    def membership_changed(self, membership: WorkspaceMemberWrite, operator_account_id: str | None) -> None:
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            BillingService.clean_billing_info_cache(membership.workspace_id)
        if (
            membership.created
            and self.rbac_enabled
            and membership.role != TenantAccountRole.OWNER
            and membership.account_status != AccountStatus.PENDING
        ):
            from tasks.initialize_created_app_rbac_access_task import sync_joined_workspace_member_rbac_access_task

            sync_joined_workspace_member_rbac_access_task.delay(
                membership.workspace_id,
                membership.account_id,
                operator_account_id=operator_account_id,
            )

    def member_removed(self, workspace_id: str, removal: WorkspaceMemberRemoval) -> None:
        if removal.account_deleted:
            logger.info("Deleted orphaned pending account: account_id=%s, email=%s", removal.account_id, removal.email)
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            BillingService.clean_billing_info_cache(workspace_id)
        from services.enterprise.account_deletion_sync import sync_workspace_member_removal

        if not sync_workspace_member_removal(
            workspace_id=workspace_id, member_id=removal.account_id, source="workspace_member_removed"
        ):
            logger.warning(
                "Enterprise workspace member removal sync failed: workspace_id=%s, member_id=%s",
                workspace_id,
                removal.account_id,
            )
        if self.rbac_enabled:
            RBACService.MemberRoles.delete_rbac_bindings(tenant_id=workspace_id, account_id=removal.account_id)


class DeploymentWorkspacePlanGateway(WorkspacePlanGateway):
    """Resolve workspace plans using deployment-specific Billing and Feature sources."""

    @override
    def resolve_many(self, workspace_ids: Sequence[str]) -> Mapping[str, str]:
        ids = tuple(workspace_ids)
        if not ids:
            return {}

        is_enterprise_only = dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE
        if is_enterprise_only:
            return dict.fromkeys(ids, str(CloudPlan.SANDBOX))

        is_saas = dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD
        bulk_plans = BillingService.get_plan_bulk(ids) if is_saas else {}
        if is_saas and not bulk_plans:
            logger.warning("get_plan_bulk returned empty result, falling back to FeatureService")

        resolved: dict[str, str] = {}
        for workspace_id in ids:
            tenant_plan = bulk_plans.get(workspace_id)
            if tenant_plan:
                resolved[workspace_id] = tenant_plan["plan"] or CloudPlan.SANDBOX
                continue

            features = FeatureService.get_features(workspace_id, exclude_vector_space=True)
            resolved[workspace_id] = features.billing.subscription.plan or CloudPlan.SANDBOX

        return resolved


class DeploymentWorkspaceFeatureGateway(WorkspaceFeatureGateway):
    @override
    def get_features(self, workspace_id: str) -> WorkspaceFeatures:
        features = FeatureService.get_features(workspace_id, exclude_vector_space=True)
        credits = EffectiveCreditPool()
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            credits = self._credit_pool(
                workspace_id, CloudPlan(features.billing.subscription.plan), features.next_credit_reset_date
            )
        return WorkspaceFeatures(can_replace_logo=features.can_replace_logo, credits=credits)

    @override
    def get_effective_credit_pool(self, workspace_id: str) -> EffectiveCreditPool:
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return EffectiveCreditPool()
        billing = BillingService.get_info(workspace_id, exclude_vector_space=True)
        return self._credit_pool(
            workspace_id, CloudPlan(billing["subscription"]["plan"]), billing.get("next_credit_reset_date")
        )

    @staticmethod
    def _credit_pool(workspace_id: str, plan: CloudPlan, reset_date: int | None) -> EffectiveCreditPool:
        # In Cloud, CreditPoolService reads the billing quota API, without an ORM Session.
        pool = None
        pool_type: Literal["paid", "trial"] = "trial"
        if plan != CloudPlan.SANDBOX:
            paid = CreditPoolService.get_pool(tenant_id=workspace_id, pool_type="paid")
            if paid is not None and (paid.quota_limit == -1 or paid.quota_limit > paid.quota_used):
                pool, pool_type = paid, "paid"
        if pool is None:
            pool = CreditPoolService.get_pool(tenant_id=workspace_id, pool_type="trial")
        if pool is None:
            return EffectiveCreditPool(plan=plan, next_credit_reset_date=reset_date)
        exhausted_at = pool.exhausted_at if isinstance(pool, CreditPoolBalance) else None
        if not (
            isinstance(exhausted_at, int)
            and exhausted_at > 0
            and pool.quota_limit > 0
            and pool.quota_used >= pool.quota_limit
        ):
            exhausted_at = None
        return EffectiveCreditPool(
            plan=plan,
            pool_type=pool_type,
            quota_limit=pool.quota_limit,
            quota_used=pool.quota_used,
            exhausted_at=exhausted_at,
            next_credit_reset_date=reset_date,
        )

    @override
    def logo_url(self, workspace_id: str) -> str:
        return f"{dify_config.FILES_URL}/files/workspaces/{workspace_id}/webapp-logo"

    @override
    def get_permission(self, workspace_id: str) -> WorkspacePermission:
        permission = EnterpriseService.WorkspacePermissionService.get_permission(workspace_id)
        return WorkspacePermission(
            workspace_id=permission.workspace_id,
            allow_member_invite=permission.allow_member_invite,
            allow_owner_transfer=permission.allow_owner_transfer,
        )


class WorkspaceFileGateway(WorkspaceLogoGateway):
    def __init__(self, *, files: FileService) -> None:
        self._files = files

    @override
    def upload(self, context: RequestContext, *, filename: str, content: bytes, mimetype: str) -> str:
        # FileService only needs the admitted account ID and its explicit tenant ID.
        owner = Account(name="", email="")
        owner.id = context.account_id
        return self._files.upload_file(
            filename=filename,
            content=content,
            mimetype=mimetype,
            user=owner,
            tenant_id=context.active_workspace_id,
        ).id


class DeploymentWorkspaceMemberRoleResolver(WorkspaceMemberRoleResolver):
    """Preserve deployment-specific legacy and enterprise role behavior."""

    @override
    def resolve_many(
        self,
        workspace_id: str,
        actor_account_id: str,
        subjects: Sequence[WorkspaceMemberRoleSubject],
    ) -> Mapping[str, Sequence[WorkspaceMemberRole]]:
        role_subjects = tuple(subjects)
        if not role_subjects:
            return {}

        if not dify_config.RBAC_ENABLED:
            return {
                subject.account_id: (WorkspaceMemberRole(id=subject.legacy_role, name=subject.legacy_role),)
                for subject in role_subjects
            }

        member_roles = enterprise_rbac_service.RBACService.MemberRoles.batch_get(
            workspace_id,
            actor_account_id,
            [subject.account_id for subject in role_subjects],
        )
        return {
            item.account_id: tuple(WorkspaceMemberRole(id=role.id, name=role.name) for role in item.roles)
            for item in member_roles
        }


class WorkspaceProvisioningEffectsGateway:
    """Prepare external resources and publish committed workspace creation."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def prepare(self, name: str) -> WorkspaceCreation:
        workspace_id = str(uuid4())
        return WorkspaceCreation(
            id=workspace_id,
            name=name,
            encrypt_public_key=generate_key_pair(workspace_id),
            trial_credits=dify_config.HOSTED_POOL_CREDITS,
            plugin_upgrade_time=PluginAutoUpgradeService.default_upgrade_time_of_day(workspace_id),
            plugin_upgrade_settings={
                category.value: PluginAutoUpgradeService.default_strategy_setting_for_category(category).value
                for category in TenantPluginAutoUpgradeCategory
            },
        )

    def bind_owner(self, workspace_id: str, account_id: str) -> None:
        if not dify_config.RBAC_ENABLED:
            return
        role_id = DeploymentWorkspaceMemberAccessGateway._role_id(workspace_id, account_id, "owner")
        # RBAC uses the enterprise API here. Its shared signature requires a
        # Session, but this call does not perform local database queries.
        with self._session_factory() as session:
            RBACService.MemberRoles.replace(
                tenant_id=workspace_id,
                account_id=account_id,
                member_account_id=account_id,
                role_ids=[role_id],
                session=session,
            )

    def created(self, workspace: CreatedWorkspace, *, owner_id: str | None) -> None:
        if owner_id is not None and dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            BillingService.clean_billing_info_cache(workspace.id)
        tenant_was_created.send(workspace)

    def join_default_workspace(self, account_id: str) -> None:
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE:
            from services.enterprise.enterprise_service import try_join_default_workspace

            try_join_default_workspace(account_id)

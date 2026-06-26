import base64
import secrets
from urllib import parse

from flask import abort
from sqlalchemy import func, select

from configs import dify_config
from constants.languages import get_valid_language
from extensions.ext_database import db
from libs.password import hash_password, valid_password
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from services.account_service import RegisterService, TenantService
from services.billing_service import BillingService
from services.errors.account import AccountAlreadyInTenantError, MemberNotInTenantError, RoleAlreadyAssignedError
from tasks.mail_invite_member_task import send_invite_member_mail_task


class PlatformAdminService:
    @staticmethod
    def _get_account_by_email_with_case_fallback(email: str) -> Account | None:
        account = db.session.execute(select(Account).where(Account.email == email)).scalar_one_or_none()
        if account or email == email.lower():
            return account

        return db.session.execute(select(Account).where(Account.email == email.lower())).scalar_one_or_none()

    @staticmethod
    def get_workspace(workspace_id: str) -> Tenant:
        tenant = db.session.get(Tenant, workspace_id)
        if tenant is None or tenant.status != TenantStatus.NORMAL:
            abort(404)
        return tenant

    @staticmethod
    def list_workspaces(*, page: int = 1, limit: int = 50, keyword: str | None = None) -> tuple[list[dict], int]:
        stmt = select(Tenant).where(Tenant.status == TenantStatus.NORMAL)
        if keyword:
            stmt = stmt.where(Tenant.name.ilike(f"%{keyword.strip()}%"))

        pagination = db.paginate(
            select=stmt.order_by(Tenant.created_at.desc()),
            page=page,
            per_page=limit,
            error_out=False,
        )
        tenants = list(pagination.items)
        tenant_ids = [tenant.id for tenant in tenants]
        owner_by_tenant: dict[str, dict] = {}
        member_count_by_tenant: dict[str, int] = {}

        if tenant_ids:
            owner_rows = db.session.execute(
                select(
                    TenantAccountJoin.tenant_id,
                    Account.id,
                    Account.name,
                    Account.email,
                )
                .join(Account, Account.id == TenantAccountJoin.account_id)
                .where(
                    TenantAccountJoin.tenant_id.in_(tenant_ids),
                    TenantAccountJoin.role == TenantAccountRole.OWNER,
                )
            ).all()
            owner_by_tenant = {
                tenant_id: {
                    "id": owner_id,
                    "name": owner_name,
                    "email": owner_email,
                }
                for tenant_id, owner_id, owner_name, owner_email in owner_rows
            }

            member_count_rows = db.session.execute(
                select(
                    TenantAccountJoin.tenant_id,
                    func.count(TenantAccountJoin.id),
                )
                .where(TenantAccountJoin.tenant_id.in_(tenant_ids))
                .group_by(TenantAccountJoin.tenant_id)
            ).all()
            member_count_by_tenant = {
                tenant_id: int(member_count or 0) for tenant_id, member_count in member_count_rows
            }

        items = [
            PlatformAdminService.serialize_workspace(
                tenant,
                owner=owner_by_tenant.get(tenant.id),
                member_count=member_count_by_tenant.get(tenant.id, 0),
            )
            for tenant in tenants
        ]
        return items, pagination.total

    @staticmethod
    def serialize_workspace(
        tenant: Tenant,
        *,
        owner: dict | None = None,
        member_count: int | None = None,
    ) -> dict:
        if owner is None:
            owner_account = (
                db.session.query(Account)
                .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
                .where(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.role == TenantAccountRole.OWNER)
                .first()
            )
            owner = (
                {
                    "id": owner_account.id,
                    "name": owner_account.name,
                    "email": owner_account.email,
                }
                if owner_account
                else None
            )

        if member_count is None:
            member_count = (
                db.session.query(func.count(TenantAccountJoin.id))
                .where(TenantAccountJoin.tenant_id == tenant.id)
                .scalar()
            )

        return {
            "id": tenant.id,
            "name": tenant.name,
            "plan": tenant.plan,
            "status": tenant.status,
            "created_at": int(tenant.created_at.timestamp()),
            "member_count": int(member_count or 0),
            "owner": owner,
        }

    @staticmethod
    def create_workspace(
        *,
        name: str,
        owner_email: str | None,
        owner_name: str | None,
        inviter: Account,
        language: str | None,
    ) -> tuple[Tenant, str | None]:
        normalized_name = name.strip()
        existing_tenant = db.session.execute(
            select(Tenant).where(
                Tenant.status == TenantStatus.NORMAL,
                func.lower(Tenant.name) == normalized_name.lower(),
            )
        ).scalar_one_or_none()
        if existing_tenant:
            abort(400, description="Workspace name already exists.")

        tenant = TenantService.create_tenant(name=normalized_name, is_from_dashboard=True)
        invitation_url = None

        if owner_email:
            invitation_url = PlatformAdminService.assign_workspace_owner(
                tenant=tenant,
                owner_email=owner_email,
                owner_name=owner_name,
                inviter=inviter,
                language=language,
            )

        return tenant, invitation_url

    @staticmethod
    def assign_workspace_owner(
        *,
        tenant: Tenant,
        owner_email: str,
        owner_name: str | None,
        inviter: Account,
        language: str | None,
    ) -> str | None:
        normalized_email = owner_email.lower()
        account = PlatformAdminService._get_account_by_email_with_case_fallback(normalized_email)

        should_send_invite = False
        if not account:
            account = RegisterService.register(
                email=normalized_email,
                name=owner_name or normalized_email.split("@")[0],
                language=get_valid_language(language),
                status=AccountStatus.PENDING,
                is_setup=True,
                create_workspace_required=False,
            )
            should_send_invite = True
        elif account.status in {AccountStatus.PENDING, AccountStatus.UNINITIALIZED}:
            should_send_invite = True

        if should_send_invite and owner_name:
            account.name = owner_name
            db.session.commit()

        TenantService.create_tenant_member(tenant, account, role=TenantAccountRole.OWNER)

        if should_send_invite:
            TenantService.switch_tenant(account, tenant.id)
            token = RegisterService.generate_invite_token(tenant, account)
            send_invite_member_mail_task.delay(
                language=account.interface_language or get_valid_language(language),
                to=account.email,
                token=token,
                inviter_name=inviter.name,
                workspace_name=tenant.name,
            )
            encoded_email = parse.quote(account.email.lower())
            return f"{dify_config.CONSOLE_WEB_URL}/activate?email={encoded_email}&token={token}"

        return None

    @staticmethod
    def get_workspace_members(tenant: Tenant) -> list[Account]:
        return TenantService.get_tenant_members(tenant)

    @staticmethod
    def invite_member(
        *,
        tenant: Tenant,
        email: str,
        language: str | None,
        role: TenantAccountRole,
        inviter: Account,
    ) -> str:
        normalized_email = email.lower()
        account = PlatformAdminService._get_account_by_email_with_case_fallback(normalized_email)

        if not account:
            account = RegisterService.register(
                email=normalized_email,
                name=normalized_email.split("@")[0],
                language=get_valid_language(language),
                status=AccountStatus.PENDING,
                is_setup=True,
                create_workspace_required=False,
            )
            TenantService.create_tenant_member(tenant, account, role)
            TenantService.switch_tenant(account, tenant.id)
        else:
            tenant_join = db.session.query(TenantAccountJoin).filter_by(
                tenant_id=tenant.id, account_id=account.id
            ).first()
            if not tenant_join:
                TenantService.create_tenant_member(tenant, account, role)

            if account.status == AccountStatus.ACTIVE:
                raise AccountAlreadyInTenantError("Account already in tenant.")

            if account.status not in {AccountStatus.PENDING, AccountStatus.UNINITIALIZED}:
                raise ValueError("Only active or pending accounts can be invited.")

            TenantService.switch_tenant(account, tenant.id)

        token = RegisterService.generate_invite_token(tenant, account)
        send_invite_member_mail_task.delay(
            language=account.interface_language or get_valid_language(language),
            to=account.email,
            token=token,
            inviter_name=inviter.name,
            workspace_name=tenant.name,
        )
        return token

    @staticmethod
    def update_member_role(*, tenant: Tenant, member: Account, new_role: TenantAccountRole) -> None:
        target_member_join = db.session.query(TenantAccountJoin).filter_by(
            tenant_id=tenant.id, account_id=member.id
        ).first()
        if not target_member_join:
            raise MemberNotInTenantError("Member not in tenant.")

        if target_member_join.role == new_role:
            raise RoleAlreadyAssignedError("The provided role is already assigned to the member.")

        target_member_join.role = TenantAccountRole(new_role)
        db.session.commit()

    @staticmethod
    def reset_member_password(*, tenant: Tenant, member: Account, new_password: str) -> None:
        tenant_join = db.session.query(TenantAccountJoin).filter_by(
            tenant_id=tenant.id,
            account_id=member.id,
        ).first()
        if not tenant_join:
            raise MemberNotInTenantError("Member not in tenant.")

        if member.status != AccountStatus.ACTIVE:
            raise ValueError("Only active accounts can have their password reset.")

        valid_password(new_password)

        salt = secrets.token_bytes(16)
        base64_salt = base64.b64encode(salt).decode()
        password_hashed = hash_password(new_password, salt)
        member.password = base64.b64encode(password_hashed).decode()
        member.password_salt = base64_salt
        db.session.add(member)
        db.session.commit()

    @staticmethod
    def remove_member(*, tenant: Tenant, account: Account) -> dict | None:
        tenant_join = db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id, account_id=account.id).first()
        if not tenant_join:
            raise MemberNotInTenantError("Member not in tenant.")

        account_id = account.id
        account_email = account.email
        db.session.delete(tenant_join)

        should_delete_account = False
        if account.status == AccountStatus.PENDING:
            remaining_joins = db.session.query(TenantAccountJoin).filter_by(account_id=account_id).count()
            if remaining_joins == 0:
                db.session.delete(account)
                should_delete_account = True

        db.session.commit()

        if dify_config.BILLING_ENABLED:
            BillingService.clean_billing_info_cache(tenant.id)

        if should_delete_account:
            return {"deleted_pending_account_email": account_email}

        return None

    @staticmethod
    def delete_workspace(*, tenant: Tenant, operator: Account) -> None:
        if operator.current_tenant_id == tenant.id:
            abort(400, description="Cannot delete the current workspace.")

        normal_workspace_count = (
            db.session.query(func.count(Tenant.id)).where(Tenant.status == TenantStatus.NORMAL).scalar()
        )
        if int(normal_workspace_count or 0) <= 1:
            abort(400, description="Cannot delete the last workspace.")

        db.session.query(TenantAccountJoin).filter_by(tenant_id=tenant.id).delete(synchronize_session=False)
        tenant.status = TenantStatus.ARCHIVE
        db.session.commit()

        if dify_config.BILLING_ENABLED:
            BillingService.clean_billing_info_cache(tenant.id)

    @staticmethod
    def rename_workspace(*, tenant: Tenant, name: str) -> Tenant:
        normalized_name = name.strip()
        existing_tenant = db.session.execute(
            select(Tenant).where(
                Tenant.id != tenant.id,
                Tenant.status == TenantStatus.NORMAL,
                func.lower(Tenant.name) == normalized_name.lower(),
            )
        ).scalar_one_or_none()
        if existing_tenant:
            abort(400, description="Workspace name already exists.")

        tenant.name = normalized_name
        db.session.commit()
        return tenant

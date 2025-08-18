from datetime import datetime, timedelta
from typing import Any, Optional

from flask import request
from flask_login import current_user

from core.helper import encrypter
from extensions.ext_database import db
from models import OperationLog, WorkspaceApiKey
from models.account import TenantAccountJoin, TenantAccountRole


class WorkspaceApiKeyService:
    @staticmethod
    def _log_operation(tenant_id: str, account_id: str, action: str, content: dict) -> None:
        """Log workspace API key operations"""
        try:
            operation_log = OperationLog(
                tenant_id=tenant_id,
                account_id=account_id,
                action=action,
                content=content,
                created_ip=request.remote_addr if request else "0.0.0.0",
            )
            db.session.add(operation_log)
            db.session.commit()
        except Exception as e:
            # ログの記録に失敗してもメイン処理は継続
            print(f"Failed to log operation: {e}")

    @staticmethod
    def create_workspace_api_key(
        tenant_id: str, account_id: str, name: str, scopes: list[str], expires_in_days: int = 30
    ) -> dict[str, Any]:
        """Create workspace management API key"""
        # Guard: ensure creator's role allows all requested scopes
        creator_join = (
            db.session.query(TenantAccountJoin)
            .filter(
                TenantAccountJoin.tenant_id == tenant_id,
                TenantAccountJoin.account_id == account_id,
            )
            .first()
        )
        if not creator_join:
            WorkspaceApiKeyService._log_operation(
                tenant_id=tenant_id,
                account_id=account_id,
                action="workspace_api_key_scope_rejected",
                content={
                    "name": name,
                    "scopes": scopes,
                    "reason": "creator_not_member",
                },
            )
            raise ValueError("Creator is not a member of the workspace")

        disallowed = [s for s in scopes if not WorkspaceApiKeyService.role_allows_scope(creator_join.role, s)]
        if disallowed:
            WorkspaceApiKeyService._log_operation(
                tenant_id=tenant_id,
                account_id=account_id,
                action="workspace_api_key_scope_rejected",
                content={
                    "name": name,
                    "role": creator_join.role,
                    "requested_scopes": scopes,
                    "disallowed_scopes": disallowed,
                },
            )
            raise ValueError("Requested scopes exceed creator's role permissions")

        # Check for duplicate names in workspace
        existing_keys = WorkspaceApiKeyService.get_workspace_api_keys(tenant_id)
        if any(key["name"] == name for key in existing_keys):
            WorkspaceApiKeyService._log_operation(
                tenant_id=tenant_id,
                account_id=account_id,
                action="workspace_api_key_name_duplicate",
                content={
                    "name": name,
                    "reason": "duplicate_name",
                },
            )
            raise ValueError("API key name already exists in this workspace")

        # Generate token
        raw_token = WorkspaceApiKey.generate_api_key()

        # Encrypt the token for secure storage
        encrypted_token = encrypter.encrypt_token(tenant_id, raw_token)

        # Calculate expiration date
        expires_at = datetime.utcnow() + timedelta(days=expires_in_days) if expires_in_days > 0 else None

        # Create API token (store encrypted version)
        api_key = WorkspaceApiKey(
            tenant_id=tenant_id,
            name=name,
            token=encrypted_token,  # Store encrypted token
            created_by=account_id,
            expires_at=expires_at,
            created_at=datetime.utcnow(),
        )

        # Set scopes
        api_key.scopes_list = scopes

        db.session.add(api_key)
        db.session.commit()

        # Log the operation
        WorkspaceApiKeyService._log_operation(
            tenant_id=tenant_id,
            account_id=account_id,
            action="workspace_api_key_created",
            content={"api_key_id": api_key.id, "name": name, "scopes": scopes, "expires_in_days": expires_in_days},
        )

        return {
            "id": api_key.id,
            "name": name,
            "token": raw_token,  # Return raw token to user (only shown once)
            "type": "workspace",
            "scopes": scopes,
            "created_at": api_key.created_at,
            "expires_at": expires_at,
        }

    @staticmethod
    def get_workspace_api_keys(tenant_id: str) -> list[dict[str, Any]]:
        """Get list of workspace management API keys"""
        api_keys = db.session.query(WorkspaceApiKey).filter(WorkspaceApiKey.tenant_id == tenant_id).all()

        result = []
        for key in api_keys:
            result.append(key.to_dict())

        return result

    @staticmethod
    def validate_workspace_api_key(token: str) -> Optional[dict[str, Any]]:
        """Validate workspace management API key"""
        if not token or not token.startswith("wsk-"):
            return None

        # Get all workspace API keys and decrypt them for comparison
        api_keys = db.session.query(WorkspaceApiKey).all()

        matching_api_key = None
        for api_key in api_keys:
            try:
                # Decrypt stored token and compare with provided token
                decrypted_token = encrypter.decrypt_token(api_key.tenant_id, api_key.token)
                if decrypted_token == token:
                    matching_api_key = api_key
                    break
            except Exception:
                # Skip invalid/corrupted tokens
                continue

        if not matching_api_key:
            return None

        # Check expiration
        if matching_api_key.expires_at and matching_api_key.expires_at < datetime.utcnow():
            return None  # 期限切れのトークン

        # Update last used time
        matching_api_key.last_used_at = datetime.utcnow()
        db.session.commit()

        # Log the API key usage
        WorkspaceApiKeyService._log_operation(
            tenant_id=matching_api_key.tenant_id,
            account_id=matching_api_key.created_by,
            action="workspace_api_key_used",
            content={"api_key_id": matching_api_key.id, "name": matching_api_key.name},
        )

        return matching_api_key.to_auth_dict()

    @staticmethod
    def update_workspace_api_key(
        tenant_id: str,
        api_key_id: str,
        name: str | None = None,
        scopes: list[str] | None = None,
        expires_in_days: int | None = None,
    ) -> Optional[dict[str, Any]]:
        """Update workspace management API key"""
        api_key = (
            db.session.query(WorkspaceApiKey)
            .filter(WorkspaceApiKey.id == api_key_id, WorkspaceApiKey.tenant_id == tenant_id)
            .first()
        )

        if not api_key:
            return None

        # Update fields if provided
        if name is not None:
            api_key.name = name
        if scopes is not None:
            # Guard: ensure updater's role allows all requested scopes
            updater_account_id = current_user.id if current_user else api_key.created_by
            updater_join = (
                db.session.query(TenantAccountJoin)
                .filter(
                    TenantAccountJoin.tenant_id == tenant_id,
                    TenantAccountJoin.account_id == updater_account_id,
                )
                .first()
            )
            if not updater_join:
                WorkspaceApiKeyService._log_operation(
                    tenant_id=tenant_id,
                    account_id=updater_account_id,
                    action="workspace_api_key_scope_rejected",
                    content={
                        "api_key_id": api_key_id,
                        "name": name or api_key.name,
                        "requested_scopes": scopes,
                        "reason": "updater_not_member",
                    },
                )
                raise ValueError("Updater is not a member of the workspace")

            disallowed = [s for s in scopes if not WorkspaceApiKeyService.role_allows_scope(updater_join.role, s)]
            if disallowed:
                WorkspaceApiKeyService._log_operation(
                    tenant_id=tenant_id,
                    account_id=updater_account_id,
                    action="workspace_api_key_scope_rejected",
                    content={
                        "api_key_id": api_key_id,
                        "name": name or api_key.name,
                        "role": updater_join.role,
                        "requested_scopes": scopes,
                        "disallowed_scopes": disallowed,
                    },
                )
                raise ValueError("Requested scopes exceed updater's role permissions")
            api_key.scopes_list = scopes
        if expires_in_days is not None:
            api_key.expires_at = datetime.utcnow() + timedelta(days=expires_in_days) if expires_in_days > 0 else None

        db.session.commit()

        # Log the update operation
        WorkspaceApiKeyService._log_operation(
            tenant_id=tenant_id,
            account_id=current_user.id if current_user else "system",
            action="workspace_api_key_updated",
            content={"api_key_id": api_key_id, "name": api_key.name, "scopes": api_key.scopes_list},
        )

        return api_key.to_dict()

    @staticmethod
    def delete_workspace_api_key(tenant_id: str, api_key_id: str) -> bool:
        """Delete workspace management API key"""
        api_key = (
            db.session.query(WorkspaceApiKey)
            .filter(WorkspaceApiKey.id == api_key_id, WorkspaceApiKey.tenant_id == tenant_id)
            .first()
        )

        if not api_key:
            return False

        # Log the deletion before deleting
        WorkspaceApiKeyService._log_operation(
            tenant_id=tenant_id,
            account_id=current_user.id if current_user else "system",
            action="workspace_api_key_deleted",
            content={"api_key_id": api_key_id, "name": api_key.name},
        )

        db.session.delete(api_key)
        db.session.commit()
        return True

    @staticmethod
    def regenerate_workspace_api_key(tenant_id: str, api_key_id: str) -> Optional[dict[str, Any]]:
        """Regenerate workspace management API key"""
        api_key = (
            db.session.query(WorkspaceApiKey)
            .filter(WorkspaceApiKey.id == api_key_id, WorkspaceApiKey.tenant_id == tenant_id)
            .first()
        )

        if not api_key:
            return None

        # Generate new token and encrypt it
        new_raw_token = WorkspaceApiKey.generate_api_key()
        new_encrypted_token = encrypter.encrypt_token(tenant_id, new_raw_token)

        api_key.token = new_encrypted_token  # Store encrypted version
        api_key.last_used_at = None

        db.session.commit()

        # Log the regeneration
        WorkspaceApiKeyService._log_operation(
            tenant_id=tenant_id,
            account_id=current_user.id if current_user else "system",
            action="workspace_api_key_regenerated",
            content={"api_key_id": api_key_id, "name": api_key.name},
        )

        return {
            "id": api_key.id,
            "name": api_key.name,
            "token": new_raw_token,  # Return raw token to user
            "type": "workspace",
            "scopes": api_key.scopes_list,
            "created_at": api_key.created_at,
            "expires_at": api_key.expires_at,
        }

    @staticmethod
    def has_scope(auth_data: dict[str, Any], required_scope: str) -> bool:
        """Check if user has required scope with hierarchical + role-based logic"""
        user_scopes = auth_data.get("scopes", [])

        # First: token scopes (with hierarchical include rules)
        allowed_by_scope = False

        # Explicit scope match
        if required_scope in user_scopes:
            allowed_by_scope = True
        else:
            # Admin scopes override everything
            if "workspace:admin" in user_scopes:
                allowed_by_scope = True
            else:
                # Hierarchical permission checks
                scope_parts = required_scope.split(":")
                if len(scope_parts) == 2:
                    resource, permission = scope_parts

                    # Admin permission for specific resource includes all permissions
                    admin_scope = f"{resource}:admin"
                    if admin_scope in user_scopes:
                        allowed_by_scope = True
                    # Write permission includes read permission
                    elif permission == "read":
                        write_scope = f"{resource}:write"
                        if write_scope in user_scopes:
                            allowed_by_scope = True

        if not allowed_by_scope:
            return False

        # Second: role-based constraint (member role must allow the scope)
        account_id = auth_data.get("account_id")
        tenant_id = auth_data.get("tenant_id")
        if not account_id or not tenant_id:
            return False

        join = (
            db.session.query(TenantAccountJoin)
            .filter(
                TenantAccountJoin.account_id == account_id,
                TenantAccountJoin.tenant_id == tenant_id,
            )
            .first()
        )
        if not join:
            return False

        allowed = WorkspaceApiKeyService.role_allows_scope(join.role, required_scope)
        if not allowed:
            # Log simple denial for observability
            try:
                WorkspaceApiKeyService._log_operation(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    action="workspace_permission_denied",
                    content={"scope": required_scope, "role": join.role},
                )
            except Exception:
                pass
            return False
        return True

    @staticmethod
    def check_multiple_scopes(auth_data: dict[str, Any], required_scopes: list[str], require_all: bool = False) -> bool:
        """Check multiple scopes with AND/OR logic"""
        if not required_scopes:
            return True

        if require_all:
            # Require ALL scopes (AND logic)
            return all(WorkspaceApiKeyService.has_scope(auth_data, scope) for scope in required_scopes)
        else:
            # Require ANY scope (OR logic)
            return any(WorkspaceApiKeyService.has_scope(auth_data, scope) for scope in required_scopes)

    @staticmethod
    def role_allows_scope(role: str, scope: str) -> bool:
        """Enforce member-role-based permission for given scope.

        Policy:
        - members:read|write|admin → admin, owner
        - apps:read → normal, editor, dataset_operator, admin, owner
        - apps:write → editor, admin, owner
        - apps:admin → admin, owner
        - workspace:read → normal, editor, dataset_operator, admin, owner
        - workspace:write → admin, owner
        """
        try:
            role_enum = TenantAccountRole(role)
        except Exception:
            return False

        def is_admin_or_owner(r: TenantAccountRole) -> bool:
            return r in {TenantAccountRole.ADMIN, TenantAccountRole.OWNER}

        resource, _, permission = scope.partition(":")
        resource = resource or scope

        if resource == "members":
            return is_admin_or_owner(role_enum)

        if resource == "apps":
            if permission in {"read", ""}:
                return role_enum in {
                    TenantAccountRole.NORMAL,
                    TenantAccountRole.EDITOR,
                    TenantAccountRole.DATASET_OPERATOR,
                    TenantAccountRole.ADMIN,
                    TenantAccountRole.OWNER,
                }
            if permission == "write":
                return role_enum in {TenantAccountRole.EDITOR, TenantAccountRole.ADMIN, TenantAccountRole.OWNER}
            if permission == "admin":
                return is_admin_or_owner(role_enum)
            return False

        if resource == "workspace":
            if permission in {"read", ""}:
                return role_enum in {
                    TenantAccountRole.NORMAL,
                    TenantAccountRole.EDITOR,
                    TenantAccountRole.DATASET_OPERATOR,
                    TenantAccountRole.ADMIN,
                    TenantAccountRole.OWNER,
                }
            if permission == "write":
                return is_admin_or_owner(role_enum)
            if permission == "admin":
                return is_admin_or_owner(role_enum)
            return False

        # Default deny for unknown resources
        return False

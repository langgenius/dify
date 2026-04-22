import logging

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, field_validator

from graphon.model_runtime.utils.encoders import jsonable_encoder
from libs.login import current_account_with_tenant, login_required
from models.credential_permission import CredentialType as CredPermType
from models.enums import PermissionEnum
from services.credential_permission_service import CredentialPermissionService

from .. import console_ns
from ..wraps import account_initialization_required, setup_required

logger = logging.getLogger(__name__)

VALID_CREDENTIAL_TYPES = {t.value for t in CredPermType}


class CredentialVisibilityPayload(BaseModel):
    visibility: str
    member_ids: list[dict] | None = None

    @field_validator("visibility")
    @classmethod
    def validate_visibility(cls, v: str) -> str:
        valid = {e.value for e in PermissionEnum}
        if v not in valid:
            raise ValueError(f"visibility must be one of {valid}")
        return v


@console_ns.route("/workspaces/current/credentials/<string:credential_type>/<string:credential_id>/visibility")
class CredentialVisibilityApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def put(self, credential_type: str, credential_id: str):
        """Update visibility for a credential. Only the creator or admin/owner can call."""
        if credential_type not in VALID_CREDENTIAL_TYPES:
            return {"error": f"Invalid credential_type. Must be one of {VALID_CREDENTIAL_TYPES}"}, 400

        user, tenant_id = current_account_with_tenant()
        payload = CredentialVisibilityPayload.model_validate(request.get_json())
        visibility = PermissionEnum(payload.visibility)

        # Look up the credential to verify ownership
        credential = _get_credential_record(credential_type, credential_id, tenant_id)
        if credential is None:
            return {"error": "Credential not found"}, 404

        # Authorization: only creator or admin/owner
        credential_user_id = getattr(credential, "user_id", None)
        if not user.is_admin_or_owner and credential_user_id != user.id:
            return {"error": "Only the credential creator or workspace admin can change visibility"}, 403

        # Update visibility on the credential record
        from extensions.ext_database import db

        credential.visibility = visibility
        db.session.commit()

        # Update partial member list
        if visibility == PermissionEnum.PARTIAL_TEAM:
            member_list = payload.member_ids or []
            CredentialPermissionService.update_partial_member_list(
                tenant_id=tenant_id,
                credential_id=credential_id,
                credential_type=credential_type,
                user_list=member_list,
            )
        else:
            CredentialPermissionService.clear_partial_member_list(
                credential_id=credential_id,
                credential_type=credential_type,
            )

        return jsonable_encoder({"result": "success", "visibility": visibility.value}), 200

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, credential_type: str, credential_id: str):
        """Get visibility and partial member list for a credential."""
        if credential_type not in VALID_CREDENTIAL_TYPES:
            return {"error": f"Invalid credential_type. Must be one of {VALID_CREDENTIAL_TYPES}"}, 400

        _, tenant_id = current_account_with_tenant()
        credential = _get_credential_record(credential_type, credential_id, tenant_id)
        if credential is None:
            return {"error": "Credential not found"}, 404

        visibility = getattr(credential, "visibility", PermissionEnum.ALL_TEAM)
        partial_members: list[str] = []
        if visibility == PermissionEnum.PARTIAL_TEAM:
            partial_members = list(CredentialPermissionService.get_partial_member_list(credential_id, credential_type))

        return jsonable_encoder(
            {
                "visibility": visibility.value if hasattr(visibility, "value") else visibility,
                "partial_member_list": partial_members,
            }
        )


def _get_credential_record(credential_type: str, credential_id: str, tenant_id: str):
    """Look up a credential record by type and id, scoped to tenant."""
    from extensions.ext_database import db
    from models.oauth import DatasourceProvider
    from models.provider import ProviderCredential
    from models.tools import BuiltinToolProvider
    from models.trigger import TriggerSubscription

    model_map = {
        CredPermType.TRIGGER_SUBSCRIPTION: TriggerSubscription,
        CredPermType.BUILTIN_TOOL_PROVIDER: BuiltinToolProvider,
        CredPermType.DATASOURCE_PROVIDER: DatasourceProvider,
        CredPermType.PROVIDER_CREDENTIAL: ProviderCredential,
    }
    model_class = model_map.get(CredPermType(credential_type))
    if model_class is None:
        return None

    return db.session.query(model_class).filter_by(id=credential_id, tenant_id=tenant_id).first()

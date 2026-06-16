"""Inner API endpoints for runtime credential resolution.

Called by Enterprise while resolving AppRunner runtime artifacts. The endpoint
returns decrypted model and tool credentials for in-memory runtime use only.
"""

import json
import logging
from json import JSONDecodeError
from typing import Any

from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.common.schema import register_schema_model
from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from core.helper import encrypter
from core.helper.provider_cache import ToolProviderCredentialsCache
from core.helper.provider_encryption import create_provider_encrypter
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from core.tools.tool_manager import ToolManager
from extensions.ext_database import db
from models.provider import ProviderCredential
from models.tools import BuiltinToolProvider

logger = logging.getLogger(__name__)

_KIND_MODEL = "model"
_KIND_TOOL = "tool"

# (body, status) pair returned by a resolver helper when resolution fails.
ResolveError = tuple[dict[str, str], int]


class InnerRuntimeCredentialResolveItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credential_id: str = Field(description="Credential id")
    provider: str = Field(description="Runtime provider identifier, for example langgenius/openai/openai")
    kind: str = Field(description="Credential kind, either 'model' or 'tool'")


class InnerRuntimeCredentialsResolvePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_id: str = Field(description="Workspace id")
    credentials: list[InnerRuntimeCredentialResolveItem] = Field(default_factory=list)


register_schema_model(inner_api_ns, InnerRuntimeCredentialsResolvePayload)


@inner_api_ns.route("/enterprise/credentials/resolve")
class EnterpriseRuntimeCredentialsResolve(Resource):
    @setup_required
    @enterprise_inner_api_only
    @inner_api_ns.doc(
        "enterprise_runtime_credentials_resolve",
        responses={
            200: "Credentials resolved",
            400: "Invalid request or credential config",
            404: "Provider or credential not found",
        },
    )
    @inner_api_ns.expect(inner_api_ns.models[InnerRuntimeCredentialsResolvePayload.__name__])
    def post(self):
        args = InnerRuntimeCredentialsResolvePayload.model_validate(inner_api_ns.payload or {})
        if not args.credentials:
            return {"credentials": []}, 200

        # Model resolution shares one provider configuration set; build it lazily
        # so a tool-only request never pays for the plugin daemon round trip.
        model_configurations = None

        resolved: list[dict[str, Any]] = []
        for item in args.credentials:
            if item.kind == _KIND_MODEL:
                if model_configurations is None:
                    provider_manager = create_plugin_provider_manager(tenant_id=args.tenant_id)
                    model_configurations = provider_manager.get_configurations(args.tenant_id)
                values, error = _resolve_model(args.tenant_id, model_configurations, item)
            elif item.kind == _KIND_TOOL:
                values, error = _resolve_tool(args.tenant_id, item)
            else:
                return {"message": f"unsupported credential kind '{item.kind}'"}, 400

            if error is not None:
                return error
            resolved.append(
                {
                    "credential_id": item.credential_id,
                    "kind": item.kind,
                    "provider": item.provider,
                    "values": values,
                }
            )

        return {"credentials": resolved}, 200


def _resolve_model(
    tenant_id: str, provider_configurations: Any, item: InnerRuntimeCredentialResolveItem
) -> tuple[dict[str, Any] | None, ResolveError | None]:
    provider_configuration = provider_configurations.get(item.provider)
    if provider_configuration is None:
        return None, ({"message": f"provider '{item.provider}' not found"}, 404)

    provider_schema = provider_configuration.provider.provider_credential_schema
    secret_variables = provider_configuration.extract_secret_variables(
        provider_schema.credential_form_schemas if provider_schema else []
    )

    with Session(db.engine) as session:
        stmt = select(ProviderCredential).where(
            ProviderCredential.id == item.credential_id,
            ProviderCredential.tenant_id == tenant_id,
            ProviderCredential.provider_name.in_(provider_configuration._get_provider_names()),
        )
        credential = session.execute(stmt).scalar_one_or_none()

    if credential is None or not credential.encrypted_config:
        return None, ({"message": f"credential '{item.credential_id}' not found"}, 404)

    try:
        values = json.loads(credential.encrypted_config)
    except JSONDecodeError:
        return None, ({"message": f"credential '{item.credential_id}' has invalid config"}, 400)
    if not isinstance(values, dict):
        return None, ({"message": f"credential '{item.credential_id}' has invalid config"}, 400)

    for key in secret_variables:
        value = values.get(key)
        if value is None:
            continue
        try:
            values[key] = encrypter.decrypt_token(tenant_id=tenant_id, token=value)
        except Exception as exc:
            logger.warning(
                "failed to resolve runtime model credential",
                extra={
                    "credential_id": item.credential_id,
                    "provider": item.provider,
                    "tenant_id": tenant_id,
                    "error": type(exc).__name__,
                },
            )
            return None, ({"message": f"credential '{item.credential_id}' decrypt failed"}, 400)

    return values, None


def _resolve_tool(
    tenant_id: str, item: InnerRuntimeCredentialResolveItem
) -> tuple[dict[str, Any] | None, ResolveError | None]:
    try:
        provider_controller = ToolManager.get_builtin_provider(item.provider, tenant_id)
    except Exception as exc:
        logger.warning(
            "failed to load runtime tool provider",
            extra={"provider": item.provider, "tenant_id": tenant_id, "error": type(exc).__name__},
        )
        return None, ({"message": f"tool provider '{item.provider}' not found"}, 404)

    with Session(db.engine) as session:
        stmt = select(BuiltinToolProvider).where(
            BuiltinToolProvider.id == item.credential_id,
            BuiltinToolProvider.provider == item.provider,
            BuiltinToolProvider.tenant_id == tenant_id,
        )
        builtin_provider = session.execute(stmt).scalar_one_or_none()

    if builtin_provider is None:
        return None, ({"message": f"credential '{item.credential_id}' not found"}, 404)

    try:
        # Tool credentials are stored as a single encrypted dict; the secret
        # fields are decided by the schema bound to this credential type.
        provider_encrypter, _ = create_provider_encrypter(
            tenant_id=tenant_id,
            config=[
                schema.to_basic_provider_config()
                for schema in provider_controller.get_credentials_schema_by_type(builtin_provider.credential_type)
            ],
            cache=ToolProviderCredentialsCache(
                tenant_id=tenant_id, provider=item.provider, credential_id=builtin_provider.id
            ),
        )
        values = dict(provider_encrypter.decrypt(builtin_provider.credentials))
    except Exception as exc:
        logger.warning(
            "failed to resolve runtime tool credential",
            extra={
                "credential_id": item.credential_id,
                "provider": item.provider,
                "tenant_id": tenant_id,
                "error": type(exc).__name__,
            },
        )
        return None, ({"message": f"credential '{item.credential_id}' decrypt failed"}, 400)

    return values, None

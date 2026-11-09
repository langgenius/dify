"""External asset use cases; network verification never dispatches business work."""

import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import asdict
from datetime import datetime, timedelta
from typing import Any

from machinery.context import RequestContext

from .contracts import (
    AssetPage,
    ExternalAgentForbiddenError,
    ExternalAgentInvalidInputError,
    ExternalAgentLimits,
    ExternalAgentVerificationFailedError,
    ExternalAsset,
    ExternalAssetAccess,
    ExternalAssetStore,
    ExternalSecretCodec,
    OperationResult,
    VerificationEvidence,
)
from .protocol import TRACEABILITY_URI, ConnectionSpec, GatewayError, GatewayPort, NoAuth, SealedBearerAuth


def configuration_fingerprint(value: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


class ExternalAssetService:
    def __init__(
        self,
        *,
        store: ExternalAssetStore,
        access: ExternalAssetAccess,
        gateway: GatewayPort,
        secrets: ExternalSecretCodec,
        clock: Callable[[], datetime],
        new_id: Callable[[], str],
        limits: ExternalAgentLimits,
    ) -> None:
        self._store = store
        self._access = access
        self._gateway = gateway
        self._secrets = secrets
        self._clock = clock
        self._new_id = new_id
        self._limits = limits

    def _require(self, context: RequestContext, *, manage: bool) -> str:
        role = self._access.role(context)
        allowed = {"owner", "admin"} if manage else {"owner", "admin", "editor"}
        if role not in allowed:
            raise ExternalAgentForbiddenError("The workspace role does not allow this operation.")
        return role

    def _visible(self, context: RequestContext, agent_id: str) -> None:
        ids = self._access.visible_agent_ids(context)
        if ids is not None and agent_id not in ids:
            raise ExternalAgentForbiddenError("The External Agent is not accessible.")

    def list(
        self,
        context: RequestContext,
        *,
        page: int,
        limit: int,
        keyword: str | None,
        enabled: bool | None,
        connected_by_me: bool,
    ) -> AssetPage:
        if self._access.role(context) not in {"owner", "admin", "editor", "normal"}:
            raise ExternalAgentForbiddenError("Workspace membership is required.")
        if page < 1 or not 1 <= limit <= 100:
            raise ExternalAgentInvalidInputError("Invalid pagination.")
        return self._store.list_assets(
            tenant_id=context.active_workspace_id,
            page=page,
            limit=limit,
            keyword=keyword,
            enabled=enabled,
            created_by=context.account_id if connected_by_me else None,
            visible_ids=self._access.visible_agent_ids(context),
        )

    def detail(self, context: RequestContext, agent_id: str) -> dict[str, Any]:
        self._require(context, manage=False)
        self._visible(context, agent_id)
        asset = self._store.get_asset(tenant_id=context.active_workspace_id, agent_id=agent_id)
        connection = self._store.get_connection(
            tenant_id=context.active_workspace_id, agent_id=agent_id, revision_id=asset.active_connection_revision_id
        )
        # Only declared display fields are exposed; unknown Card metadata and
        # credential-like provider extensions are not a Console response surface.
        card_keys = (
            "name",
            "description",
            "provider",
            "version",
            "documentationUrl",
            "skills",
            "defaultInputModes",
            "defaultOutputModes",
            "supportedInterfaces",
            "capabilities",
            "iconUrl",
        )
        return {
            "asset": asdict(asset),
            "connection": {
                "revision_id": connection.id,
                "endpoint": connection.endpoint,
                "interface_url": connection.interface_url,
                "auth_type": connection.auth_type,
                "has_credential": bool(connection.credential_ciphertext),
                "auth_check": connection.auth_check,
                "verified_at": connection.verified_at,
                "profile": connection.profile,
                "card": {k: connection.card[k] for k in card_keys if k in connection.card},
                "capabilities": connection.capabilities,
            },
        }

    def verify(
        self,
        context: RequestContext,
        *,
        endpoint: str,
        auth_type: str,
        credential_action: str,
        credential: str | None,
        agent_id: str | None,
        expected_connection_revision_id: str | None,
    ) -> VerificationEvidence:
        self._require(context, manage=True)
        if auth_type not in {"none", "bearer"} or credential_action not in {"keep", "replace", "remove"}:
            raise ExternalAgentInvalidInputError("Unsupported authentication configuration.")
        previous = None
        if agent_id is not None:
            asset = self._store.get_asset(tenant_id=context.active_workspace_id, agent_id=agent_id)
            if expected_connection_revision_id != asset.active_connection_revision_id:
                from .contracts import ExternalAgentConflictError

                raise ExternalAgentConflictError("The connection changed; load its current configuration.")
            previous = self._store.get_connection(
                tenant_id=context.active_workspace_id,
                agent_id=agent_id,
                revision_id=asset.active_connection_revision_id,
            )
        elif expected_connection_revision_id is not None:
            raise ExternalAgentInvalidInputError("A new asset cannot select a previous connection.")
        sealed = None
        if auth_type == "none":
            if credential:
                raise ExternalAgentInvalidInputError("None authentication cannot contain a credential.")
            auth = NoAuth()
        else:
            if credential_action == "keep":
                if previous is None or previous.auth_type != "bearer" or not previous.credential_ciphertext:
                    raise ExternalAgentInvalidInputError("A saved Bearer credential is required to keep it.")
                sealed = previous.credential_ciphertext
            elif credential_action == "replace":
                if (
                    not credential
                    or len(credential) > 8192
                    or re.fullmatch(r"[A-Za-z0-9._~+/-]+=*", credential) is None
                ):
                    raise ExternalAgentInvalidInputError("A valid Bearer credential is required.")
                if (
                    previous
                    and previous.credential_ciphertext
                    and self._secrets.matches(context.active_workspace_id, previous.credential_ciphertext, credential)
                ):
                    sealed = previous.credential_ciphertext
                else:
                    sealed = self._secrets.encrypt(context.active_workspace_id, credential)
            else:
                raise ExternalAgentInvalidInputError("Bearer authentication requires a credential.")
            auth = SealedBearerAuth(context.active_workspace_id, sealed)
        try:
            result = self._gateway.verify(
                ConnectionSpec(endpoint=endpoint, authentication=auth),
                timeout_seconds=self._limits.request_timeout_seconds,
            )
        except GatewayError as error:
            raise ExternalAgentVerificationFailedError(str(error)) from error
        declaration = result.card.get("capabilities")
        declared_extensions = declaration.get("extensions", []) if isinstance(declaration, dict) else []
        extensions = declared_extensions if isinstance(declared_extensions, list) else []
        caps = {
            "streaming": result.streaming,
            "remote_tenant": result.remote_tenant,
            "required_extensions": list(result.required_extensions),
            "traceability_supported": any(x.get("uri") == TRACEABILITY_URI for x in extensions if isinstance(x, dict)),
        }
        now = self._clock()
        evidence = VerificationEvidence(
            id=self._new_id(),
            tenant_id=context.active_workspace_id,
            actor_id=context.account_id,
            agent_id=agent_id,
            endpoint=endpoint,
            interface_url=result.interface_url,
            auth_type=auth_type,
            credential_ciphertext=sealed,
            auth_check=result.auth_check,
            card=result.card,
            capabilities=caps,
            fingerprint=configuration_fingerprint(
                {
                    "endpoint": endpoint,
                    "interface": result.interface_url,
                    "auth_type": auth_type,
                    "credential": sealed,
                    "card": result.card_fingerprint,
                    "profile": result.profile_version,
                }
            ),
            expected_connection_revision_id=expected_connection_revision_id,
            created_at=now,
            expires_at=now + timedelta(seconds=self._limits.verification_seconds),
        )
        self._store.save_verification(evidence)
        return evidence

    def create(
        self, context: RequestContext, *, verification_id: str, metadata: dict[str, Any], operation_key: str
    ) -> OperationResult:
        self._require(context, manage=True)
        self._validate_operation_key(operation_key)
        self._validate_info(metadata, creation=True)
        return self._store.create_asset(
            context=context,
            evidence_id=verification_id,
            metadata=metadata,
            operation_key=operation_key,
            fingerprint=configuration_fingerprint({"verification": verification_id, "metadata": metadata}),
        )

    def update_connection(
        self,
        context: RequestContext,
        *,
        agent_id: str,
        verification_id: str,
        expected_revision_id: str,
        operation_key: str,
    ) -> OperationResult:
        self._require(context, manage=True)
        self._validate_operation_key(operation_key)
        return self._store.update_connection(
            context=context,
            agent_id=agent_id,
            evidence_id=verification_id,
            expected_revision_id=expected_revision_id,
            operation_key=operation_key,
            fingerprint=configuration_fingerprint(
                {
                    "agent": agent_id,
                    "verification": verification_id,
                    "expected": expected_revision_id,
                }
            ),
        )

    def update_info(
        self, context: RequestContext, *, agent_id: str, expected_revision: int, changes: dict[str, Any]
    ) -> ExternalAsset:
        self._require(context, manage=True)
        self._validate_info(changes, creation=False)
        return self._store.update_info(
            context=context, agent_id=agent_id, expected_revision=expected_revision, changes=changes
        )

    def set_enabled(self, context: RequestContext, agent_id: str, enabled: bool) -> ExternalAsset:
        self._require(context, manage=True)
        return self._store.set_enabled(context=context, agent_id=agent_id, enabled=enabled)

    def set_tracing(self, context: RequestContext, agent_id: str, enabled: bool) -> ExternalAsset:
        self._require(context, manage=True)
        asset = self._store.get_asset(tenant_id=context.active_workspace_id, agent_id=agent_id)
        connection = self._store.get_connection(
            tenant_id=context.active_workspace_id, agent_id=agent_id, revision_id=asset.active_connection_revision_id
        )
        if enabled and not connection.capabilities.get("traceability_supported"):
            raise ExternalAgentInvalidInputError("This Agent does not declare the supported Traceability profile.")
        return self._store.set_tracing(context=context, agent_id=agent_id, enabled=enabled)

    def delete(self, context: RequestContext, agent_id: str) -> None:
        self._require(context, manage=True)
        self._store.archive(context=context, agent_id=agent_id)

    def operation(self, context: RequestContext, operation_id: str) -> OperationResult:
        self._require(context, manage=True)
        return self._store.operation(context=context, operation_id=operation_id)

    @staticmethod
    def _validate_operation_key(key: str) -> None:
        if not key or len(key) > 255:
            raise ExternalAgentInvalidInputError("An idempotency key of 1..255 characters is required.")

    @staticmethod
    def _validate_info(value: dict[str, Any], *, creation: bool) -> None:
        if set(value) - {"name", "description", "role", "icon_type", "icon", "icon_background"}:
            raise ExternalAgentInvalidInputError("Only local presentation fields can be edited.")
        if "name" in value and (
            not isinstance(value["name"], str) or not 1 <= len(value["name"]) <= 255 or not value["name"].strip()
        ):
            raise ExternalAgentInvalidInputError("Name must contain 1..255 characters.")
        for key, maximum in [("description", 10000), ("role", 255), ("icon", 255), ("icon_background", 255)]:
            if (
                key in value
                and value[key] is not None
                and (not isinstance(value[key], str) or len(value[key]) > maximum)
            ):
                raise ExternalAgentInvalidInputError("Invalid presentation field.")
        if value.get("icon_type") not in {None, "emoji", "image", "link"}:
            raise ExternalAgentInvalidInputError("Unsupported icon type.")

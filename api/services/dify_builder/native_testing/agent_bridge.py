"""Agent wire adapter to the existing authorization and credential owners.

The private wire has no actor or tenant authority. Server composition is mandatory
and reconstructs the owner from the persisted request before granting access.
Validation does not consume a transport fence and never replaces one.
"""

import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, Protocol, cast

from dify_agent.adapters.native_testing.client import AgentMaterialization, AgentPhysicalDispatchPayload
from dify_agent.protocol.native_testing import (
    AgentApprovalWait,
    AgentDispatchPermit,
    AgentEffectDecision,
    AgentEffectIntent,
    AgentEffectReceipt,
    AgentNativeTestRef,
    AgentPolicyStop,
    AgentRecordedResult,
    AgentRunTransportSelection,
)
from flask import current_app
from werkzeug.local import LocalProxy
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.dify_builder.models import Actor
from extensions.ext_database import db
from models.dify_builder import DifyBuilderExecutionRequest
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest, canonical_json
from services.dify_builder.native_testing.agent_lineage import AgentServicePrincipal, NativeAgentEndpointContext
from services.dify_builder.native_testing.authorization import EffectAuthorizationService
from services.dify_builder.native_testing.contracts import (
    ApprovalWait,
    DispatchPermit,
    EffectIntent,
    NativeTestContextRef,
    OperationKey,
    Outcome,
    PolicyStop,
    RecordedResult,
)
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from services.tools.builtin_tools_manage_service import BuilderCredentialRuntime, BuiltinToolManageService


@dataclass(frozen=True)
class AgentCredentialBinding:
    """Trusted protected configuration resolution, never constructed from wire authority."""

    actor: Actor
    tool_ref: str
    provider_id: str
    credential_id: str | None
    verified_plugin: bool
    implementation_revision: str
    requirements_ref: str


class NativeAgentCredentialMaterializer:
    """Separate OAuth and business phases using the existing native credential owners.

    Selection is metadata only. Claim, decrypt, OAuth and CAS are sequential and
    no network/crypto call runs in a SQL transaction. A business permit cannot
    refresh; it is consumed at the eventual physical tool dispatcher, not here.
    """

    def __init__(self, *, authorization: EffectAuthorizationService, resolve_binding: Callable):
        self.authorization = authorization
        self.resolve_binding = resolve_binding

    def inspect(
        self, *, ref: NativeTestContextRef, tool_ref: str
    ) -> tuple[AgentCredentialBinding, BuilderCredentialRuntime | None]:
        self.authorization.loader.load(ref=ref)
        binding = self.resolve_binding(ref=ref, tool_ref=tool_ref)
        if (
            not isinstance(binding, AgentCredentialBinding)
            or binding.actor != self.authorization.loader.actor
            or binding.tool_ref != tool_ref
        ):
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        if binding.credential_id is None:
            return binding, None
        try:
            selection = BuiltinToolManageService.load_builder_credential(
                actor=binding.actor,
                provider_id=binding.provider_id,
                credential_id=binding.credential_id,
                verified_plugin=binding.verified_plugin,
            )
        except BuilderExecutionPolicyError as error:
            if error.reason_code != "needs_setup":
                raise
            return binding, None
        return binding, selection

    @staticmethod
    def account_ref(selection: BuilderCredentialRuntime) -> str:
        return canonical_digest(selection.snapshot.reference.model_dump(mode="json"))

    @staticmethod
    def refresh_due(selection: BuilderCredentialRuntime) -> bool:
        reference = selection.snapshot.reference
        return (
            reference.credential_type == "oauth2"
            and reference.expires_at != -1
            and reference.expires_at - 60 < int(time.time())
        )

    def materialize(
        self,
        *,
        ref: NativeTestContextRef,
        intent: EffectIntent,
        permit: DispatchPermit,
        tool_ref: str,
        phase: Literal["refresh", "business"],
    ) -> AgentMaterialization:
        if (
            intent.resource_ref != tool_ref
            or intent.kind != ("oauth" if phase == "refresh" else "tool")
            or phase not in {"refresh", "business"}
        ):
            raise BuilderExecutionPolicyError("native_materialization_phase_mismatch")
        self.authorization.validate_dispatch(ref=ref, intent=intent, permit=permit)
        binding, selection = self.inspect(ref=ref, tool_ref=tool_ref)
        if selection is None or binding.credential_id is None:
            raise BuilderExecutionPolicyError("needs_setup")
        if (
            intent.account_ref != self.account_ref(selection)
            or intent.implementation_revision != binding.implementation_revision
        ):
            raise BuilderExecutionPolicyError("native_credential_drift")
        due = self.refresh_due(selection)
        if (phase == "business" and due) or (phase == "refresh" and not due):
            raise BuilderExecutionPolicyError("native_materialization_phase_mismatch")

        from configs import dify_config
        from core.entities import PluginCredentialType
        from core.helper.credential_utils import runtime_check_credential_policy_compliance
        from core.helper.provider_cache import NoOpProviderCredentialCache, ToolProviderCredentialsCache
        from core.plugin.entities.plugin_daemon import CredentialType
        from core.plugin.impl.oauth import OAuthHandler
        from core.tools.tool_manager import ToolManager
        from core.tools.utils.encryption import create_provider_encrypter
        from models.provider_ids import ToolProviderID

        controller = ToolManager.get_builtin_provider(binding.provider_id, binding.actor.tenant_id)
        if getattr(controller, "plugin_unique_identifier", None) != binding.implementation_revision:
            raise BuilderExecutionPolicyError("installed_tool_unavailable")
        credential_type = CredentialType.of(selection.snapshot.reference.credential_type)
        # Refresh is the sole physical owner of this permit; the claim commits
        # before decrypting any credential or contacting the OAuth endpoint.
        if phase == "refresh":
            self.authorization.claim_dispatch(ref=ref, intent=intent, permit=permit)
        try:
            runtime_check_credential_policy_compliance(
                credential_id=binding.credential_id,
                provider=binding.provider_id,
                credential_type=PluginCredentialType.TOOL,
                check_existence=False,
            )
            encrypter, _ = create_provider_encrypter(
                tenant_id=binding.actor.tenant_id,
                config=[
                    x.to_basic_provider_config() for x in controller.get_credentials_schema_by_type(credential_type)
                ],
                cache=NoOpProviderCredentialCache(),
            )
            stored = json.loads(selection.snapshot.encrypted_credentials or "{}")
            if not isinstance(stored, dict):
                raise ValueError("credential shape")
            credentials = encrypter.decrypt(stored)
            if phase == "business":
                return AgentMaterialization(
                    credential_type=credential_type.value, credentials=dict(credentials), runtime_parameters={}
                )
            provider = ToolProviderID(binding.provider_id)
            client = BuiltinToolManageService.decrypt_builder_oauth_client(
                tenant_id=binding.actor.tenant_id, provider_controller=controller, client=selection.snapshot.client
            )
            refreshed = OAuthHandler().refresh_credentials(
                tenant_id=binding.actor.tenant_id,
                user_id=selection.owner_user_id,
                plugin_id=provider.plugin_id,
                provider=provider.provider_name,
                redirect_uri=f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{binding.provider_id}/tool/callback",
                system_credentials=client,
                credentials=credentials,
            )
            reference = BuiltinToolManageService.persist_native_agent_refresh(
                actor=binding.actor,
                provider_id=binding.provider_id,
                verified_plugin=binding.verified_plugin,
                selection=selection,
                encrypted_credentials=json.dumps(encrypter.encrypt(refreshed.credentials)),
                expires_at=refreshed.expires_at,
            )
            ToolProviderCredentialsCache(
                tenant_id=binding.actor.tenant_id, provider=binding.provider_id, credential_id=binding.credential_id
            ).delete()
            # The refresh result contains only an opaque reference; tokens never
            # enter the durable result owner or the returned refresh envelope.
            return AgentMaterialization(
                credential_type="oauth2",
                credentials={},
                runtime_parameters={"credential_ref": canonical_digest(reference.model_dump(mode="json"))},
            )
        except BuilderExecutionPolicyError:
            raise
        except Exception:
            raise BuilderExecutionPolicyError("native_credential_phase_failed") from None


@dataclass
class NativeAgentCredentialPhases:
    """Called by the trusted continuation owner with its frozen child intent.

    The caller must persist that OAuth child intent before calling refresh and
    keep replaying it after restart, even if the rotated credential is now fresh.
    No business permit is requested until this child has a completed receipt.
    """

    authorization: EffectAuthorizationService
    materializer: NativeAgentCredentialMaterializer
    state_store: NativeExecutionStateStore

    def prepare_business(
        self,
        *,
        ref: NativeTestContextRef,
        key: OperationKey,
        tool_ref: str,
        target,
        parameters,
        input_digest: str,
        capability_digest: str,
        refresh_intent: EffectIntent | None,
    ) -> EffectIntent | ApprovalWait | PolicyStop:
        """Readiness precedes freezing the actual account or reserving business.

        The continuation owner supplies its durable OAuth child intent when one
        exists, including after a crash following CAS. Absence is never inferred
        from the now-fresh token. A due token with no frozen child fails closed.
        """
        wait = self.configuration_wait(ref=ref, tool_ref=tool_ref)
        if wait is not None:
            return wait
        if refresh_intent is not None:
            expected_key = key.model_copy(update={"occurrence_path": (*key.occurrence_path, "oauth_refresh")})
            if refresh_intent.key != expected_key or refresh_intent.resource_ref != tool_ref:
                raise BuilderExecutionPolicyError("native_refresh_owner_mismatch")
            wait = self.refresh(ref=ref, intent=refresh_intent)
            if wait is not None:
                return wait
        binding, selection = self.materializer.inspect(ref=ref, tool_ref=tool_ref)
        if selection is None:
            raise BuilderExecutionPolicyError("native_credential_drift")
        if self.materializer.refresh_due(selection):
            return PolicyStop(reason_code="native_refresh_continuation_required")
        return EffectIntent(
            key=key,
            kind="tool",
            resource_ref=tool_ref,
            implementation_revision=binding.implementation_revision,
            account_ref=self.materializer.account_ref(selection),
            target=target,
            parameters=parameters,
            input_digest=input_digest,
            capability_digest=capability_digest,
        )

    def configuration_wait(self, *, ref: NativeTestContextRef, tool_ref: str) -> ApprovalWait | None:
        from services.dify_builder.native_testing.pending_actions import NativePendingActionService

        binding, selection = self.materializer.inspect(ref=ref, tool_ref=tool_ref)
        if selection is not None:
            return None
        owned = self.authorization.loader.load(ref=ref)
        return NativePendingActionService(self.authorization.loader).configuration(
            ref=ref,
            requirements_ref=binding.requirements_ref,
            expected_generation=owned.generation,
        )

    def refresh(self, *, ref: NativeTestContextRef, intent: EffectIntent) -> ApprovalWait | PolicyStop | None:
        if intent.kind != "oauth":
            raise BuilderExecutionPolicyError("native_materialization_phase_mismatch")
        decision = self.authorization.before_call(ref=ref, intent=intent)
        if isinstance(decision, (ApprovalWait, PolicyStop)):
            return decision
        if isinstance(decision, RecordedResult):
            result = self.state_store.load_result(ref=ref, result_ref=decision.result_ref)
            if not isinstance(result, dict) or not isinstance(result.get("credential_ref"), str):
                raise BuilderExecutionPolicyError("native_refresh_result_invalid")
            return None
        try:
            materialized = self.materializer.materialize(
                ref=ref, intent=intent, permit=decision, tool_ref=intent.resource_ref, phase="refresh"
            )
            result_ref = self.state_store.store_result(ref=ref, key=intent.key, result=materialized.runtime_parameters)
        except Exception:
            self.authorization.record_outcome(permit=decision, outcome="unknown", result_ref=None)
            raise
        self.authorization.record_outcome(permit=decision, outcome="completed", result_ref=result_ref)
        return None


def api_ref(ref: AgentNativeTestRef) -> NativeTestContextRef:
    return NativeTestContextRef(
        policy_version=ref.policy_version,
        request_id=ref.request_id,
        invocation_id=ref.invocation_id,
        context_digest=ref.context_digest,
    )


def api_intent(intent: AgentEffectIntent) -> EffectIntent:
    return EffectIntent(
        key=OperationKey(
            invocation_id=intent.key.invocation_id, occurrence_path=intent.key.occurrence_path, cursor=intent.key.cursor
        ),
        kind=intent.kind,
        resource_ref=intent.resource_ref,
        implementation_revision=intent.implementation_revision,
        account_ref=intent.account_ref,
        target=intent.target,
        parameters=intent.parameters,
        input_digest=intent.input_digest,
        capability_digest=intent.capability_digest,
    )


def api_permit(permit: AgentDispatchPermit) -> DispatchPermit:
    return DispatchPermit(
        permit_id=permit.permit_id,
        attempt_id=permit.attempt_id,
        operation_id=permit.operation_id,
        expires_at=permit.expires_at,
    )


class AgentReadinessPort(Protocol):
    """Resolve configuration/form ownership before creating an actual-account effect.

    Implementations use NativePendingActionService, preserve its durable owner
    reference, and perform only inert metadata reads. They do not refresh tokens.
    """

    def prepare(self, *, ref: NativeTestContextRef, intent: EffectIntent) -> ApprovalWait | None: ...


class AgentDispatchFence(Protocol):
    """NW4 durable at-most-once physical dispatch claim across workers/restart.

    Must reject repeated or concurrent requests for the same permit, including
    after ambiguous failure. There is no in-memory/default implementation.
    """

    def claim_dispatch(
        self,
        *,
        ref: NativeTestContextRef,
        intent: EffectIntent,
        permit: DispatchPermit,
    ) -> None: ...


class AgentCredentialMaterializer(Protocol):
    """Existing credential owner, exact phase, outside SQL. Business never refreshes.

    Refresh must persist through the existing credential CAS before returning;
    its successful outcome cannot authorize or spend a business permit.
    """

    def materialize(
        self,
        *,
        ref: NativeTestContextRef,
        intent: EffectIntent,
        permit: DispatchPermit,
        tool_ref: str,
        phase: Literal["refresh", "business"],
    ) -> AgentMaterialization: ...


@dataclass
class AgentNativeTestingBridge:
    authorization: EffectAuthorizationService
    readiness: AgentReadinessPort | None
    materializer: AgentCredentialMaterializer | None
    fence: AgentDispatchFence | None

    def before_call(self, *, ref: AgentNativeTestRef, intent: AgentEffectIntent) -> AgentEffectDecision:
        owned_ref, effect = api_ref(ref), api_intent(intent)
        if self.readiness is not None:
            self.authorization.loader.load(ref=owned_ref)
            wait = self.readiness.prepare(ref=owned_ref, intent=effect)
            if wait is not None:
                if wait.wait_reason == "approval":
                    raise BuilderExecutionPolicyError("native_readiness_reason_invalid")
                return AgentApprovalWait(pending_operation_id=wait.pending_operation_id, wait_reason=wait.wait_reason)
        decision = self.authorization.before_call(ref=owned_ref, intent=effect)
        if isinstance(decision, ApprovalWait):
            return AgentApprovalWait(
                pending_operation_id=decision.pending_operation_id, wait_reason=decision.wait_reason
            )
        if isinstance(decision, PolicyStop):
            return AgentPolicyStop(reason_code=decision.reason_code)
        if isinstance(decision, RecordedResult):
            return AgentRecordedResult(operation_id=decision.operation_id, result_ref=decision.result_ref)
        return AgentDispatchPermit(
            permit_id=decision.permit_id,
            attempt_id=decision.attempt_id,
            operation_id=decision.operation_id,
            expires_at=decision.expires_at,
        )

    def record_outcome(
        self, *, ref: AgentNativeTestRef, permit: AgentDispatchPermit, outcome: Outcome, result_ref: str | None
    ) -> AgentEffectReceipt:
        native_permit = api_permit(permit)
        # Settlement retains the original request owner even after revocation.
        if self.authorization._permit_ref(native_permit) != api_ref(ref):
            raise BuilderExecutionPolicyError("invalid_dispatch_permit")
        receipt = self.authorization.record_outcome(permit=native_permit, outcome=outcome, result_ref=result_ref)
        return AgentEffectReceipt(
            operation_id=receipt.operation_id,
            attempt_id=receipt.attempt_id,
            outcome=receipt.outcome,
            result_ref=receipt.result_ref,
        )

    def materialize(
        self,
        *,
        ref: AgentNativeTestRef,
        intent: AgentEffectIntent,
        permit: AgentDispatchPermit,
        tool_ref: str,
        phase: Literal["refresh", "business"],
    ) -> AgentMaterialization:
        owned_ref, effect, native_permit = api_ref(ref), api_intent(intent), api_permit(permit)
        if (
            (phase == "refresh" and effect.kind != "oauth")
            or (phase == "business" and effect.kind != "tool")
            or effect.resource_ref != tool_ref
        ):
            raise BuilderExecutionPolicyError("native_materialization_phase_mismatch")
        if self.fence is not self.authorization:
            raise BuilderExecutionPolicyError("native_dispatch_fence_unavailable")
        if self.materializer is None:
            raise BuilderExecutionPolicyError("native_materialization_unavailable")
        self.authorization.validate_dispatch(ref=owned_ref, intent=effect, permit=native_permit)
        # The materializer owns refresh claim_dispatch immediately before its
        # physical OAuth boundary. Business consumption belongs to the tool
        # dispatcher. Never consume the same permit again at this HTTP adapter.
        return self.materializer.materialize(
            ref=owned_ref, intent=effect, permit=native_permit, tool_ref=tool_ref, phase=phase
        )


def agent_bridge_for_ref(ref: AgentNativeTestRef) -> AgentNativeTestingBridge:
    """Service-authenticated route supplies only a ref; actor comes from SQL."""
    with Session(db.engine) as session:
        row = session.scalar(
            select(DifyBuilderExecutionRequest).where(DifyBuilderExecutionRequest.id == ref.request_id)
        )
        if row is None or row.context_digest != ref.context_digest:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        actor = Actor(account_id=row.actor_id, tenant_id=row.tenant_id)
    factory = current_app.extensions.get("native_agent_bridge_factory")
    if factory is None:
        raise BuilderExecutionPolicyError("native_agent_bridge_unavailable")
    bridge = factory(actor=actor)
    if not isinstance(bridge, AgentNativeTestingBridge) or bridge.authorization.loader.actor != actor:
        raise BuilderExecutionPolicyError("native_agent_bridge_unavailable")
    return bridge


class AgentEndpointLineagePort(Protocol):
    """Strict transport principal and exact private selection are mandatory.

    None denotes a positively verified ordinary Run, never missing identity.
    Native contexts are validated admissions, never physical dispatch permits.
    """

    def resolve(
        self,
        *,
        principal: AgentServicePrincipal,
        selection: AgentRunTransportSelection,
        boundary: str,
        caller: dict,
    ) -> NativeAgentEndpointContext | None: ...


def claim_agent_endpoint(
    *,
    boundary: str,
    caller: dict,
    envelope: AgentPhysicalDispatchPayload | None,
    target,
    parameters,
    kind: str,
    physical_owner_ready: bool = False,
) -> None:
    """Compatibility service preflight; strict Resources already prove lineage.

    Genuine legacy plugin paths retain their service authorization. S2a refuses
    native effects before service work. A controller cannot spend a
    permit, including when called with an explicit native envelope.
    """
    from flask import g, request

    context = (
        getattr(g, "agent_runtime_context", None)
        if getattr(g, "agent_runtime_request", None) is cast(LocalProxy, request)._get_current_object()
        else None
    )
    if context is None:
        if envelope is not None:
            raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
        return
    if (
        not isinstance(context, NativeAgentEndpointContext)
        or envelope is None
        or envelope.ref != context.ref
    ):
        raise BuilderExecutionPolicyError("native_endpoint_owner_mismatch")
    effect = envelope.intent
    if (
        effect.kind != kind
        or canonical_json(effect.target) != canonical_json(target)
        or canonical_json(effect.parameters) != canonical_json(parameters)
    ):
        raise BuilderExecutionPolicyError("native_endpoint_arguments_mismatch")
    # No implemented service/runtime owner consumes this permit adjacent to its
    # physical call yet. Validation is not a dispatch claim, even if a caller
    # supplies physical_owner_ready=True to this compatibility preflight.
    raise BuilderExecutionPolicyError("native_endpoint_dependency_unavailable")

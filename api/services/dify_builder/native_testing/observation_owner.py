"""Trusted persisted-profile composition, without dispatch or physical authority."""

from collections.abc import Callable

from sqlalchemy import select

from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from services.dify_builder.execution_contracts import canonical_digest
from services.dify_builder.native_testing.context_binding import NativeRuntimeProfile
from services.dify_builder.native_testing.contracts import NativeTestContextRef
from services.dify_builder.native_testing.http_binding import _current_metadata
from services.dify_builder.native_testing.observation_adapters import NativeObservationError, NativeObservationGuard
from services.dify_builder.native_testing.observation_privacy import NativeHttpObservationPolicy, _shape
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader, utc_now
from services.dify_builder.native_testing.runtime_contracts import ResolvedNativeTestContext
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore, invocation_state


def _checked_context(context: ResolvedNativeTestContext) -> ResolvedNativeTestContext:
    # Inspect plain shapes before serialization can render unchecked model_copy objects.
    if type(context) is not ResolvedNativeTestContext or type(context.ref) is not NativeTestContextRef:
        raise NativeObservationError()
    if context.model_extra or set(context.__dict__) != set(ResolvedNativeTestContext.model_fields):
        raise NativeObservationError()
    if context.ref.model_extra or set(context.ref.__dict__) != set(NativeTestContextRef.model_fields):
        raise NativeObservationError()
    data = {name: getattr(context, name) for name in ResolvedNativeTestContext.model_fields}
    data["ref"] = {name: getattr(context.ref, name) for name in NativeTestContextRef.model_fields}
    _shape(data)
    return ResolvedNativeTestContext.model_validate(data, strict=True)


def _stored_profile(
    state: NativeExecutionStateStore, context: ResolvedNativeTestContext
) -> tuple[NativeRuntimeProfile, tuple[str, str]]:
    with state.loader.session_factory() as session:
        owned, scope = state.loader._load(session, ref=context.ref, lock=False)
        request = session.scalar(
            select(DifyBuilderExecutionRequest).where(
                DifyBuilderExecutionRequest.id == context.ref.request_id,
                DifyBuilderExecutionRequest.tenant_id == context.tenant_id,
                DifyBuilderExecutionRequest.actor_id == context.actor_id,
                DifyBuilderExecutionRequest.context_digest == context.ref.context_digest,
            )
        )
        local = invocation_state(session, context.ref, owned.tenant_id)
        inputs = session.get(DifyBuilderTestInput, owned.test_input_id)
        if (
            request is None
            or inputs is None
            or scope.expires_at <= utc_now()
            or context.parent_invocation_id is not None
            or context.call_depth != 0
            or (local.generation, local.app_id, local.workflow_id, local.parent_invocation_id)
            != (context.generation, context.app_id, context.workflow_id, None)
            or (owned.tenant_id, owned.actor_id, owned.app_id, owned.workflow_id)
            != (context.tenant_id, context.actor_id, context.app_id, context.workflow_id)
            or canonical_digest(inputs.inputs) != context.input_revision
        ):
            raise NativeObservationError()
        expected = {
            "policy_version": context.ref.policy_version,
            "request_id": context.ref.request_id,
            "invocation_id": context.ref.invocation_id,
            "tenant_id": owned.tenant_id,
            "actor_id": owned.actor_id,
            "app_id": owned.app_id,
            "workflow_id": owned.workflow_id,
            "session_id": owned.session_id,
            "test_input_id": owned.test_input_id,
            "native_run_id": context.native_run_id,
            "mode": "native",
            "execution_revision": context.graph_revision,
            "input_revision": context.input_revision,
            "start_schema_hash": inputs.start_schema_hash,
        }
        if any(request.context.get(key) != value for key, value in expected.items()):
            raise NativeObservationError()
        profile = NativeRuntimeProfile.model_validate(request.context.get("profile"))
        from services.dify_builder.native_testing.sandbox.qualification import (
            PROFILE_ID as CODE_PROFILE_ID,
        )
        from services.dify_builder.native_testing.sandbox.qualification import (
            NativeCodeBindingResolver,
            current_metadata,
        )

        code_qualification = None
        if profile.profile_id == CODE_PROFILE_ID:
            if type(state.loader.resolver) is not NativeCodeBindingResolver:
                raise NativeObservationError()
            code_qualification = state.loader.resolver.qualification
            code_qualification.validate_profile(profile)
        digest = canonical_digest(list(context.resource_manifest))
        if digest != request.context.get("resource_manifest_digest"):
            raise NativeObservationError()
        for descriptor in context.resource_manifest:
            node_id = descriptor.get("node_id")
            if type(node_id) is not str:
                raise NativeObservationError()
            if code_qualification is None:
                _, current, current_digest = _current_metadata(
                    session=session, owned=owned, node_id=node_id
                )
            else:
                _, current, current_digest = current_metadata(
                    session=session,
                    owned=owned,
                    node_id=node_id,
                    qualification=code_qualification,
                )
            if current_digest != digest or canonical_digest(current) != canonical_digest(descriptor):
                raise NativeObservationError()
        return profile, (canonical_digest(request.context), local.context_object_id)


def create_http_observation_guard(
    *, state: NativeExecutionStateStore, context: ResolvedNativeTestContext, on_failure: Callable[[], None]
) -> NativeObservationGuard:
    """Qualify only the current protected root HTTP profile; no substitute inputs.

    Private context reads and permission checks use their actual owners outside
    writers. This is structural privacy qualification, not a physical claim or
    authority to disclose old resume history.
    """
    try:
        if type(state) is not NativeExecutionStateStore or type(state.loader) is not OwnedNativeTestLoader:
            raise NativeObservationError()
        supplied = _checked_context(context)
        state.loader.load(ref=supplied.ref)
        actual = state.load_context(ref=supplied.ref)
        profile, stamp = _stored_profile(state, actual)
        from services.dify_builder.native_testing.sandbox.qualification import (
            NativeCodeBindingResolver,
        )

        resolver = state.loader.resolver
        options = (
            {"code_qualification": resolver.qualification}
            if type(resolver) is NativeCodeBindingResolver
            else {}
        )
        policy = NativeHttpObservationPolicy.qualify(
            context=supplied, profile=profile, **options
        )
        if canonical_digest(actual.model_dump(mode="json")) != canonical_digest(supplied.model_dump(mode="json")):
            raise NativeObservationError()
        current = state.load_context(ref=supplied.ref)
        final_profile, final_stamp = _stored_profile(state, current)
        if (
            stamp != final_stamp
            or profile != final_profile
            or canonical_digest(actual.model_dump(mode="json")) != canonical_digest(current.model_dump(mode="json"))
        ):
            raise NativeObservationError()
        return NativeObservationGuard(policy=policy, on_failure=on_failure)
    except BaseException:
        raise NativeObservationError() from None

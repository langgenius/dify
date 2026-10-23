"""Code-only trusted qualification and current native resource binding.

No production qualification issuer is installed. A required server owner must
validate actual immutable empty-snapshot and deployment facts; DTOs, SQL flags,
environment probes and copied digests never establish those facts. Its validate
method is a local currentness check, including when called under C02's writer;
provisioning, deployment measurement and RPC belong outside that transaction.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from importlib.metadata import version
from inspect import getsource
from types import MappingProxyType
from typing import Annotated, NoReturn, Protocol, cast, runtime_checkable
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, uuid5

from pydantic import Field, JsonValue, SecretStr, TypeAdapter
from shellctl.shared.schemas import NativeScopeLimits, NativeScopeSpec
from sqlalchemy import select

from configs import dify_config
from core.dify_builder.models import Actor
from core.helper.code_executor.code_executor import CodeExecutor
from graphon.nodes.code.code_node import CodeNode
from graphon.nodes.code.entities import CodeLanguage, CodeNodeData
from graphon.nodes.code.limits import CodeNodeLimits
from graphon.nodes.template_transform.entities import TemplateTransformNodeData
from graphon.nodes.template_transform.template_transform_node import (
    TemplateTransformNode,
)
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeEffectOperation,
    NativeInvocationState,
    NativePendingAction,
    NativeTestInvocation,
)
from runtime_contracts.builder.execution import (
    BuilderExecutionPolicyError,
    Digest,
    canonical_digest,
    canonical_json,
)
from runtime_contracts.builder.native.approval_contracts import (
    NativeApprovalProposal,
    NativeApprovalTerms,
)
from runtime_contracts.builder.native.contracts import (
    ID,
    EffectIntent,
    FiniteJSON,
    FrozenDTO,
    operation_digest,
)
from services.code_execution.native_scope_transport import (
    NativeCodeBounds,
    NativeCodeProfile,
)
from services.dify_builder.execution_policy_service import check_execution_permission
from services.dify_builder.native_testing.context_binding import NativeRuntimeProfile
from services.dify_builder.native_testing.control import marked_native_node_class
from services.dify_builder.native_testing.http_binding import _redacted_shape
from services.dify_builder.native_testing.private_reads import (
    validate_invocation_workflow,
    validate_private_read,
)
from services.dify_builder.native_testing.public_contracts import (
    PendingActionDisclosure,
)
from services.dify_builder.native_testing.repository import (
    NativeBinding,
    native_workflow_revision,
)
from services.dify_builder.native_testing.runtime_bridge import NativeContextUnavailable
from services.dify_builder.native_testing.sandbox.contracts import (
    CodeScopeSpec,
    SnapshotID,
)
from services.dify_builder.native_testing.transitions import require_ancestor_authority

PROFILE_ID = "builder-native-code-no-network-v1"
BOUNDS = MappingProxyType(
    {
        "cpu_quota": 100000,
        "memory_bytes": 256 << 20,
        "pids": 32,
        "fds": 128,
        "disk_bytes": 64 << 20,
        "wall_seconds": 30,
        "input_bytes": 1 << 20,
        "output_bytes": 1 << 20,
        "max_pages": 256,
        "create_seconds": 5,
        "execution_seconds": 10,
        "close_seconds": 5,
        "destroy_seconds": 5,
        "join_seconds": 1,
        "result_bytes": 8 << 20,
    }
)


def refuse() -> NoReturn:
    raise BuilderExecutionPolicyError("native_code_qualification_unavailable") from None


class NativeCodeCapability(FrozenDTO):
    """Complete server snapshot, not an attestation or ready flag."""

    bounds: tuple[tuple[str, int], ...]
    deployment_ref: ID
    image_digest: Digest
    environment_digest: Digest
    python_digest: Digest
    node_digest: Digest
    empty_snapshot_ref: SnapshotID
    empty_snapshot_digest: Digest
    endpoint: Annotated[str, Field(strict=True, min_length=1, max_length=2048)]
    auth_token: SecretStr
    python_executable: Annotated[str, Field(strict=True, pattern=r"^/[A-Za-z0-9_./-]+$")]
    node_executable: Annotated[str, Field(strict=True, pattern=r"^/[A-Za-z0-9_./-]+$")]


@runtime_checkable
class NativeCodeQualificationOwner(Protocol):
    def validate(self, *, capability: NativeCodeCapability) -> None:
        """Revalidate actual complete qualification; local only, no IO/RPC.

        The real trusted issuer/provisioner is an unresolved delivery gate.
        Implementations must verify the exact fixed BOUNDS as deployment facts,
        authenticated endpoint, content-bound secret-free empty snapshot and
        image/interpreter/environment identities. Return None or refuse.
        """
        ...


class NativeCodeQualification:
    def __init__(self, *, capability: NativeCodeCapability, owner: NativeCodeQualificationOwner):
        try:
            if (
                type(capability) is not NativeCodeCapability
                or not isinstance(owner, NativeCodeQualificationOwner)
                or not callable(owner.validate)
            ):
                refuse()
            cap = NativeCodeCapability.model_validate(capability.model_dump(mode="python"), strict=True)
            if cap.bounds != tuple(sorted(BOUNDS.items())):
                refuse()
            endpoint = urlsplit(cap.endpoint)
            if (
                endpoint.scheme not in ("http", "https")
                or not endpoint.hostname
                or endpoint.path not in ("", "/")
                or endpoint.username
                or endpoint.password
                or endpoint.query
                or endpoint.fragment
                or not cap.auth_token.get_secret_value()
            ):
                refuse()
            if any(
                part in (".", "..", "")
                for executable in (cap.python_executable, cap.node_executable)
                for part in executable.split("/")[1:]
            ):
                refuse()
            self.capability, self.owner = cap, owner
            self._identity = self._fingerprint()
            self.check()
        except Exception:
            refuse()

    def _fingerprint(self):
        cap = self.capability
        material = cap.model_dump(mode="json")
        material["auth_token"] = cap.auth_token.get_secret_value()
        return canonical_digest({"capability": material, "bounds": dict(BOUNDS)})

    def check(self) -> None:
        try:
            if self._fingerprint() != self._identity:
                refuse()
            if self.owner.validate(capability=self.capability) is not None or self._fingerprint() != self._identity:
                refuse()
        except Exception:
            refuse()

    def descriptor(self) -> dict:
        self.check()
        cap = self.capability
        return {
            "deployment_ref": cap.deployment_ref,
            "image_digest": cap.image_digest,
            "environment_digest": cap.environment_digest,
            "python_digest": cap.python_digest,
            "node_digest": cap.node_digest,
            "empty_snapshot_ref": cap.empty_snapshot_ref,
            "empty_snapshot_digest": cap.empty_snapshot_digest,
            "endpoint_digest": canonical_digest(cap.endpoint),
            "python_executable": cap.python_executable,
            "node_executable": cap.node_executable,
            "bounds": dict(BOUNDS),
        }

    def profile(self) -> NativeRuntimeProfile:
        return NativeRuntimeProfile(
            profile_id=PROFILE_ID,
            implementation_revision=canonical_digest(self.descriptor()),
            limits={"calls": 16, "dispatches": 16, "cost_units": 16},
        )

    def validate_profile(self, profile: NativeRuntimeProfile) -> None:
        if type(profile) is not NativeRuntimeProfile or profile != self.profile():
            refuse()


# Current graph/config metadata uses the same Dify owners as the HTTP lane.


_JSON = TypeAdapter(FiniteJSON)


def code_limits():
    return CodeNodeLimits(
        max_string_length=min(dify_config.CODE_MAX_STRING_LENGTH, BOUNDS["output_bytes"]),
        max_number=dify_config.CODE_MAX_NUMBER,
        min_number=dify_config.CODE_MIN_NUMBER,
        max_precision=dify_config.CODE_MAX_PRECISION,
        max_depth=dify_config.CODE_MAX_DEPTH,
        max_number_array_length=dify_config.CODE_MAX_NUMBER_ARRAY_LENGTH,
        max_string_array_length=dify_config.CODE_MAX_STRING_ARRAY_LENGTH,
        max_object_array_length=dify_config.CODE_MAX_OBJECT_ARRAY_LENGTH,
    )


def template_limit():
    return min(dify_config.TEMPLATE_TRANSFORM_MAX_LENGTH, BOUNDS["output_bytes"])


def supported(raw):
    try:
        if type(raw) is not dict or raw.get("version", "1") != "1" or version("graphon") != "0.8.0":
            refuse()
        kind = raw.get("type")
        if kind == "code":
            node = CodeNodeData.model_validate(raw)
            cls = CodeNode
            if node.dependencies:
                refuse()
        elif kind == "template-transform":
            node, cls = (
                TemplateTransformNodeData.model_validate(raw),
                TemplateTransformNode,
            )
        else:
            refuse()
        if cls.get_node_type_classes_mapping().get(kind, {}).get("1") is not cls:
            refuse()
        if len({x.variable for x in node.variables}) != len(node.variables) or any(
            len(x.value_selector) < 2 or x.value_selector[0] in {"env", "sys", "conversation"} for x in node.variables
        ):
            refuse()
        return node, cls
    except Exception:
        refuse()


def describe_code_resource(*, qualification, node_id, raw, workflow_revision, app_id, workflow_id):
    if type(qualification) is not NativeCodeQualification:
        refuse()
    node, cls = supported(raw)
    return {
        "kind": "code",
        "node_id": node_id,
        "app_id": app_id,
        "workflow_id": workflow_id,
        "workflow_revision": workflow_revision,
        "node_config_digest": canonical_digest(raw),
        "native_type": node.type,
        "native_version": cls.version(),
        "native_class": cls.__module__ + "." + cls.__name__,
        "graphon_version": version("graphon"),
        "implementation_revision": qualification.profile().implementation_revision,
        "qualification": qualification.descriptor(),
        "code_limits": asdict(code_limits()),
        "template_limit": template_limit(),
        "transformer_digest": canonical_digest(
            {
                name.value: {
                    "runner": transformer.get_runner_script(),
                    "preload": transformer.get_preload_script(),
                    "class": transformer.__module__ + "." + transformer.__name__,
                    "sources": [
                        hashlib.sha256(getsource(base).encode()).hexdigest()
                        for base in (CodeExecutor, *transformer.__mro__[:-1])
                    ],
                }
                for name, transformer in CodeExecutor.code_template_transformers.items()
            }
        ),
        "policy": {
            "isolated": True,
            "egress": False,
            "new_data": False,
            "destructive": False,
            "approval_scope": "operation",
            "cost_units": 1,
            "additional_budget": {},
        },
    }


def _node(graph, node_id):
    nodes = [n["data"] for n in graph.get("nodes", []) if n.get("id") == node_id]
    if len(nodes) != 1:
        refuse()
    return nodes[0]


def _entries(*, qualification, graph, revision, app_id, workflow_id):
    # Other effect families are unavailable in this profile. Actual scalar
    # schemas/classes continue to be qualified by the existing native host.
    if any(n.get("data", {}).get("type") in {"http-request", "agent"} for n in graph.get("nodes", [])):
        refuse()
    entries = tuple(
        describe_code_resource(
            qualification=qualification,
            node_id=n["id"],
            raw=n["data"],
            workflow_revision=revision,
            app_id=app_id,
            workflow_id=workflow_id,
        )
        for n in graph.get("nodes", [])
        if n.get("data", {}).get("type") in {"code", "template-transform"}
    )
    if len({x["node_id"] for x in entries}) != len(entries):
        refuse()
    return entries


class NativeCodeResourceSnapshot:
    def __init__(self, *, session_factory, qualification):
        self._sessions, self.qualification = session_factory, qualification

    def __call__(
        self,
        *,
        actor: Actor,
        app_id: str,
        workflow_id: str,
        graph: dict[str, JsonValue],
        profile: NativeRuntimeProfile,
    ) -> tuple[dict[str, JsonValue], ...]:
        self.qualification.validate_profile(profile)
        check_execution_permission(actor, app_id, self._sessions)
        with self._sessions() as session:
            workflow = validate_invocation_workflow(
                session,
                tenant_id=actor.tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
            )
            if json.loads(workflow.graph) != graph or workflow._environment_variables not in (None, "", "[]", "{}"):
                refuse()
            return cast(
                tuple[dict[str, JsonValue], ...],
                _entries(
                    qualification=self.qualification,
                    graph=graph,
                    revision=native_workflow_revision(workflow),
                    app_id=app_id,
                    workflow_id=workflow_id,
                ),
            )


def current_metadata(*, session, owned, node_id, qualification):
    qualification.check()  # required trusted local-only currentness; no RPC under writer
    state = session.scalar(
        select(NativeInvocationState).where(
            NativeInvocationState.tenant_id == owned.tenant_id,
            NativeInvocationState.request_id == owned.ref.request_id,
            NativeInvocationState.invocation_id == owned.ref.invocation_id,
        )
    )
    if state is None or not state.app_id or not state.workflow_id:
        refuse()
    require_ancestor_authority(session, owned.ref, owned.tenant_id)
    workflow = validate_invocation_workflow(
        session,
        tenant_id=owned.tenant_id,
        app_id=state.app_id,
        workflow_id=state.workflow_id,
    )
    request = session.get(DifyBuilderExecutionRequest, owned.ref.request_id)
    if request is None or workflow._environment_variables not in (None, "", "[]", "{}"):
        refuse()
    qualification.validate_profile(NativeRuntimeProfile.model_validate(request.context.get("profile")))
    graph, revision = json.loads(workflow.graph), native_workflow_revision(workflow)
    entries = _entries(
        qualification=qualification,
        graph=graph,
        revision=revision,
        app_id=workflow.app_id,
        workflow_id=workflow.id,
    )
    digest = canonical_digest(list(entries))
    if digest != request.context.get("resource_manifest_digest"):
        refuse()
    raw = _node(graph, node_id)
    descriptor = describe_code_resource(
        qualification=qualification,
        node_id=node_id,
        raw=raw,
        workflow_revision=revision,
        app_id=workflow.app_id,
        workflow_id=workflow.id,
    )
    if descriptor not in entries:
        refuse()
    return raw, descriptor, digest


def classified_binding(*, intent_digest, execution_id, descriptor, manifest_digest):
    return NativeBinding(
        intent_digest=intent_digest,
        kind="code",
        resource_ref=descriptor["node_id"],
        implementation_revision=descriptor["implementation_revision"],
        account_ref=None,
        capability_digest=manifest_digest,
        resource_version=descriptor["workflow_revision"],
        credential_version=None,
        isolated=True,
        egress=False,
        new_data=False,
        destructive=False,
        approval_scope="operation",
        cost_units=1,
        budget={},
        execution_id=execution_id,
        invocation_digest=intent_digest,
    )


class NativeCodeBindingResolver:
    def __init__(self, *, qualification):
        self.qualification = qualification

    def resolve_binding(self, *, session, owned, key):
        if key.invocation_id != owned.ref.invocation_id:
            refuse()
        frozen = NativeBinding.model_validate(owned.bindings.get(operation_digest(key)))
        if frozen.kind != "code" or key.occurrence_path != (frozen.execution_id,):
            refuse()
        _, descriptor, digest = current_metadata(
            session=session,
            owned=owned,
            node_id=frozen.resource_ref,
            qualification=self.qualification,
        )
        return classified_binding(
            intent_digest=frozen.intent_digest,
            execution_id=frozen.execution_id,
            descriptor=descriptor,
            manifest_digest=digest,
        )

    def resolve_pending(self, **kwargs):
        refuse()


@dataclass(frozen=True)
class PreparedCodeCall:
    intent: EffectIntent
    spec: CodeScopeSpec
    profile: NativeCodeProfile
    bounds: NativeCodeBounds
    language: CodeLanguage
    code: str
    inputs: dict
    runner: str
    preload: str


class NativeCodeBindingProducer:
    def __init__(self, *, association, loader, state_store, journal, qualification):
        self.association, self.loader, self.store, self.journal = (
            association,
            loader,
            state_store,
            journal,
        )
        self.qualification = qualification
        self._context = self._cursor = None

    def _snapshot(self, context):
        raw = _node(context.graph, self.association.node_id)
        expected, cls = supported(raw)
        node = self.association.bound_node
        if type(node) is not marked_native_node_class(cls, marked=True) or canonical_digest(
            node.node_data.model_dump(mode="json")
        ) != canonical_digest(expected.model_dump(mode="json")):
            refuse()
        descriptor = describe_code_resource(
            qualification=self.qualification,
            node_id=self.association.node_id,
            raw=raw,
            workflow_revision=context.graph_revision,
            app_id=context.app_id,
            workflow_id=context.workflow_id,
        )
        if context.resource_manifest.count(descriptor) != 1:
            refuse()
        return expected, descriptor

    def _current_inputs(self, context, node):
        expected = {}
        graph_ids = {n["id"] for n in context.graph["nodes"]}
        for variable in node.variables:
            if variable.value_selector[0] not in graph_ids:
                refuse()
            value = self.association.runtime_state.variable_pool.get(variable.value_selector)
            if value is not None and str(value.value_type) in {
                "secret",
                "file",
                "array[file]",
            }:
                refuse()
            expected[variable.variable] = value.to_object() if value else None
        return _JSON.validate_python(expected, strict=True)

    def validate_prepared(self, prepared):
        try:
            context = self.association.resolve()
            node, descriptor = self._snapshot(context)
            material = prepared.intent.parameters
            if (
                canonical_json(self._current_inputs(context, node)) != canonical_json(prepared.inputs)
                or canonical_digest(list(context.resource_manifest)) != prepared.intent.capability_digest
                or any(
                    descriptor[key] != material[key]
                    for key in (
                        "node_config_digest",
                        "qualification",
                        "transformer_digest",
                        "code_limits",
                        "template_limit",
                    )
                )
            ):
                refuse()
            return context
        except (BuilderExecutionPolicyError, NativeContextUnavailable):
            raise
        except Exception:
            refuse()

    def prepare(self, *, language, code, inputs):
        try:
            return self._prepare(language=language, code=code, inputs=inputs)
        except (BuilderExecutionPolicyError, NativeContextUnavailable):
            raise
        except Exception:
            refuse()

    def _prepare(self, *, language, code, inputs):
        context = self.association.resolve()  # actual attachment/public UUID first
        self.qualification.check()
        node, descriptor = self._snapshot(context)
        expected_language = node.code_language if isinstance(node, CodeNodeData) else CodeLanguage.JINJA2
        expected_code = node.code if isinstance(node, CodeNodeData) else node.template
        if type(language) is not CodeLanguage or language != expected_language or code != expected_code:
            refuse()
        expected = self._current_inputs(context, node)
        checked = _JSON.validate_python(inputs, strict=True)
        if type(checked) is not dict or canonical_json(checked) != canonical_json(
            _JSON.validate_python(expected, strict=True)
        ):
            refuse()
        owned = self.loader.load(ref=context.ref)
        authority = validate_private_read(self.loader, context.ref)
        if authority.generation != context.generation:
            refuse()
        transformer = CodeExecutor.code_template_transformers[language]
        runner, preload = transformer.transform_caller(code, checked)
        payload = (
            json.dumps(
                {"preload": preload, "code": runner},
                ensure_ascii=True,
                separators=(",", ":"),
            )
            + "\n"
        ).encode()
        if len(payload) > BOUNDS["input_bytes"]:
            refuse()
        material = {
            "language": language.value,
            "code": code,
            "inputs": checked,
            "node_config_digest": descriptor["node_config_digest"],
            "qualification": descriptor["qualification"],
            "transformer_digest": descriptor["transformer_digest"],
            "runner_digest": hashlib.sha256(runner.encode()).hexdigest(),
            "preload_digest": hashlib.sha256(preload.encode()).hexdigest(),
            "code_limits": descriptor["code_limits"],
            "template_limit": descriptor["template_limit"],
        }
        input_ref = self.store.store_node_inputs(
            ref=context.ref,
            generation=context.generation,
            native_execution_id=self.association.execution_id,
            inputs=material,
        )
        if canonical_json(self.store.load_result(ref=context.ref, result_ref=input_ref)) != canonical_json(material):
            refuse()
        cursor = self.journal.open(ref=context.ref, occurrence_path=self.association.occurrence_path)
        cursor.bind_input(input_result_ref=input_ref, inputs=material)
        key = cursor.next_key()
        cap = self.qualification.capability
        running = CodeExecutor.code_language_to_running_language[language]
        profile = NativeCodeProfile(
            language=running,
            executable=cap.node_executable if running == "nodejs" else cap.python_executable,
            environment_digest=cap.environment_digest,
        )
        # A deterministic scope identity belongs to this exact logical effect,
        # never to a new retry. Durable reservation still permits exactly one POST.
        scope_id = (
            "code_"
            + uuid5(
                NAMESPACE_URL,
                canonical_digest(
                    {
                        "ref": context.ref.model_dump(mode="json"),
                        "key": key.model_dump(mode="json"),
                    }
                ),
            ).hex
        )
        limits = NativeScopeLimits(
            **{
                k: BOUNDS[k]
                for k in (
                    "cpu_quota",
                    "memory_bytes",
                    "pids",
                    "fds",
                    "disk_bytes",
                    "wall_seconds",
                    "input_bytes",
                    "output_bytes",
                )
            }
        )
        spec = CodeScopeSpec(
            native=NativeScopeSpec(
                scope_id=scope_id,
                binding_ref=scope_id,
                generation=1,
                base_snapshot_ref=cap.empty_snapshot_ref,
                input_file_refs=(),
                network_targets=(),
                capability_digest=canonical_digest(list(context.resource_manifest)),
                deadline=owned.expires_at,
                limits=limits,
            ),
            environment_digest=cap.environment_digest,
            base_snapshot_digest=cap.empty_snapshot_digest,
        )
        profile_digest = hashlib.sha256(json.dumps(asdict(profile), sort_keys=True).encode()).hexdigest()
        intent = EffectIntent(
            key=key,
            kind="code",
            resource_ref=self.association.node_id,
            implementation_revision=descriptor["implementation_revision"],
            account_ref=None,
            target={
                "code_physical": {
                    "scope_spec_digest": canonical_digest(spec.native.model_dump(mode="json")),
                    "environment_digest": cap.environment_digest,
                    "base_snapshot_ref": cap.empty_snapshot_ref,
                    "base_snapshot_digest": cap.empty_snapshot_digest,
                    "payload_digest": hashlib.sha256(payload).hexdigest(),
                    "profile_digest": profile_digest,
                }
            },
            parameters=material,
            input_digest=canonical_digest(material),
            capability_digest=canonical_digest(list(context.resource_manifest)),
        )
        self.loader.load(ref=context.ref)
        if validate_private_read(self.loader, context.ref) != authority or self.association.resolve() != context:
            refuse()
        self._install(context=context, authority=authority, descriptor=descriptor, intent=intent)
        self._context, self._cursor = context, cursor
        return PreparedCodeCall(
            intent,
            spec,
            profile,
            NativeCodeBounds(
                timeout_seconds=10,
                output_bytes=BOUNDS["output_bytes"],
                max_pages=256,
                input_bytes=BOUNDS["input_bytes"],
                close_seconds=5,
            ),
            language,
            code,
            checked,
            runner,
            preload,
        )

    def _install(self, *, context, authority, descriptor, intent):
        from services.dify_builder.native_testing.state_store import (
            NativeExecutionStateStore,
        )

        with self.loader.locked(ref=context.ref) as (session, owned, scope):
            NativeExecutionStateStore._validate_node_inputs_owner(
                session, owned, scope, context, authority, context.generation
            )
            _, current, digest = current_metadata(
                session=session,
                owned=owned,
                node_id=self.association.node_id,
                qualification=self.qualification,
            )
            if (
                current != descriptor
                or digest != intent.capability_digest
                or self.association.execution_id != intent.key.occurrence_path[0]
            ):
                refuse()
            binding = classified_binding(
                intent_digest=canonical_digest(intent.model_dump(mode="json")),
                execution_id=self.association.execution_id,
                descriptor=current,
                manifest_digest=digest,
            )
            invocation = session.scalar(
                select(NativeTestInvocation).where(
                    NativeTestInvocation.tenant_id == owned.tenant_id,
                    NativeTestInvocation.request_id == context.ref.request_id,
                    NativeTestInvocation.invocation_id == context.ref.invocation_id,
                    NativeTestInvocation.active.is_(True),
                )
            )
            if invocation is None:
                refuse()
            identity = operation_digest(intent.key)
            original = invocation.bindings.get(identity)
            if original is not None and NativeBinding.model_validate(original) != binding:
                refuse()
            if original is None:
                invocation.bindings = {
                    **invocation.bindings,
                    identity: binding.model_dump(mode="json"),
                }

    def approval_proposals(self):
        if self._context is None or self._cursor is None or self.association.resolve() != self._context:
            refuse()
        owned = self.loader.load(ref=self._context.ref)
        return tuple(
            NativeApprovalProposal(
                key=intent.key,
                terms=NativeApprovalTerms(
                    max_calls=1,
                    max_dispatches=1,
                    max_cost_units=1,
                    expires_at=owned.expires_at.isoformat(),
                ),
            )
            for intent in self._cursor.snapshot().intents
        )

    def finish(self):
        if self._cursor is None:
            refuse()
        self._cursor.finish()


def code_disclosure_summary(*, intent, descriptor):
    if type(intent.parameters) is not dict or type(intent.target) is not dict:
        refuse()
    return (
        {"language": intent.parameters["language"], "kind": "isolated_code"},
        {
            "input_digest": intent.input_digest,
            "typed_shape": _redacted_shape(intent.parameters.get("inputs")),
            "source_workflow_revision": descriptor["workflow_revision"],
            "network_scope": "none",
            "redacted_fields": ["code", "template", "inputs", "outputs"],
            "max_result_bytes": BOUNDS["result_bytes"],
        },
    )


class NativeCodeDisclosure:
    """Actual protected pending intent, current classification and bounded public notice."""

    def __init__(self, *, loader, state_store, qualification):
        self.qualification = qualification
        from services.dify_builder.native_testing.pending_intents import (
            ProtectedPendingIntentReader,
        )

        self.loader = loader
        self.reader = ProtectedPendingIntentReader(loader=loader, state_store=state_store)

    def describe(self, *, actor: Actor, resolved) -> PendingActionDisclosure:
        if actor != self.loader.actor or resolved.intent.kind != "code":
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        proposed = self.reader.load_terms(resolved=resolved, for_projection=True)  # Actual protected proposal.
        owned = self.loader.load(ref=resolved.ref)
        terms = NativeApprovalTerms(
            max_calls=1,
            max_dispatches=1,
            max_cost_units=1,
            expires_at=owned.expires_at.isoformat(),
        )
        if proposed != terms:
            raise BuilderExecutionPolicyError("native_approval_proposal_unavailable")
        with self.loader.session_factory() as session:
            binding = NativeCodeBindingResolver(qualification=self.qualification).resolve_binding(
                session=session, owned=owned, key=resolved.intent.key
            )
            if (
                binding.intent_digest != canonical_digest(resolved.intent.model_dump(mode="json"))
                or binding.destructive
                or binding != NativeBinding.model_validate(owned.bindings.get(operation_digest(resolved.intent.key)))
            ):
                raise BuilderExecutionPolicyError("native_binding_drift")
            _, descriptor, _ = current_metadata(
                session=session,
                owned=owned,
                node_id=binding.resource_ref,
                qualification=self.qualification,
            )
            pending = session.scalar(
                select(NativePendingAction)
                .join(
                    NativeEffectOperation,
                    NativeEffectOperation.id == NativePendingAction.operation_id,
                )
                .where(
                    NativeEffectOperation.tenant_id == owned.tenant_id,
                    NativeEffectOperation.request_id == resolved.ref.request_id,
                    NativeEffectOperation.invocation_id == resolved.ref.invocation_id,
                    NativeEffectOperation.operation_digest == operation_digest(resolved.intent.key),
                    NativeEffectOperation.intent_digest == binding.intent_digest,
                    NativePendingAction.tenant_id == owned.tenant_id,
                    NativePendingAction.request_id == resolved.ref.request_id,
                    NativePendingAction.invocation_id == resolved.ref.invocation_id,
                    NativePendingAction.category == "approval",
                    NativePendingAction.owner_version == self._scope(resolved.intent, binding),
                )
            )
            if pending is None or pending.generation != resolved.generation:
                raise BuilderExecutionPolicyError("native_pending_conflict")
            pending_id, scope_digest = pending.id, pending.owner_version
        target, summary = code_disclosure_summary(intent=resolved.intent, descriptor=descriptor)
        return PendingActionDisclosure(
            pending_operation_id=pending_id,
            wait_reason="approval",
            version=resolved.generation + 1,
            scope_digest=scope_digest,
            account_label=None,
            action="Run one isolated Code or Template operation",
            target=target,
            parameters_summary=summary,
            risk_notice=(
                "One isolated operation with no network or files; submitted source, inputs and results are redacted."
            ),
            required_configuration=(),
            native_form_ref=None,
            approval_limits=terms,
        )

    @staticmethod
    def _scope(intent, binding):
        # Reuse C02's canonical scope recipe; prose never defines grant authority.
        from services.dify_builder.native_testing.authorization import _scope_digest

        return _scope_digest(intent, binding)

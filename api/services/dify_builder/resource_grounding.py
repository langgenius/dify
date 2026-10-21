"""Ground changed model/tool identities in the acting workspace's catalogue.

A catalogue proves declaration/configuration facts, never successful execution.
Unchanged historical nodes are intentionally outside this write-time boundary.
"""

import re
from collections.abc import Sequence
from typing import Any

from services.dify_builder.agent.resources import ResourceRef, TenantResources
from services.dify_builder.errors import PreflightError


class ResourceBindingError(PreflightError):
    def __init__(self, reason_code: str, node_id: str, kind: str) -> None:
        self.reason_code = reason_code
        self.node_id = node_id if re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", node_id) else "unknown_node"
        self.resource_kind = kind
        super().__init__(f"{reason_code}: {self.node_id} ({kind})")


def _identity(data: dict[str, Any]) -> tuple[str, ...] | None:
    if not isinstance(data, dict):
        return None
    if data.get("type") == "llm":
        model = data.get("model")
        if not isinstance(model, dict):
            return None
        provider, name = str(model.get("provider") or ""), str(model.get("name") or "")
        # An explicitly blank editor node claims no configured resource.
        # Partial/guessed identities still have to match the real catalogue.
        return ("model", provider, name) if provider or name else None
    if data.get("type") == "tool":
        provider, name = str(data.get("provider_id") or ""), str(data.get("tool_name") or "")
        return ("tool", str(data.get("provider_type") or "builtin"), provider, name) if provider or name else None
    return None


def _ref_identity(kind: str, ref: ResourceRef) -> tuple[str, ...]:
    binding = ref.binding
    if kind == "model":
        return (kind, str(binding.get("provider") or ""), str(binding.get("name") or ""))
    return (
        kind,
        str(binding.get("provider_type") or "builtin"),
        str(binding.get("provider_id") or ""),
        str(binding.get("tool_name") or ""),
    )


def changed_resource_nodes(before: dict, after: dict) -> list[dict]:
    previous = {str(node.get("id")): node.get("data") or {} for node in before.get("nodes", [])}
    changed = []
    for node in after.get("nodes", []):
        data = node.get("data") or {}
        identity = _identity(data)
        if identity is not None and identity != _identity(previous.get(str(node.get("id")), {})):
            changed.append(node)
    return changed


def _validate_unbound_tool_drafts(before: dict, after: dict) -> None:
    """A blank Tool is a canvas draft, never a newly wired executable resource."""
    old_nodes = {str(node.get("id")): node for node in before.get("nodes", [])}

    def reachable_nodes(graph: dict) -> set[str]:
        pending = [
            str(node.get("id")) for node in graph.get("nodes", []) if (node.get("data") or {}).get("type") == "start"
        ]
        successors: dict[str, list[str]] = {}
        for edge in graph.get("edges", []):
            successors.setdefault(str(edge.get("source")), []).append(str(edge.get("target")))
        reached: set[str] = set()
        while pending:
            node_id = pending.pop()
            if node_id not in reached:
                reached.add(node_id)
                pending.extend(successors.get(node_id, []))
        return reached

    newly_reachable = reachable_nodes(after) - reachable_nodes(before)

    def incident_edges(graph: dict, node_id: str) -> set[tuple[str, str, str, str]]:
        return {
            (
                str(edge.get("source")),
                str(edge.get("target")),
                str(edge.get("sourceHandle", "")),
                str(edge.get("targetHandle", "")),
            )
            for edge in graph.get("edges", [])
            if node_id in {str(edge.get("source")), str(edge.get("target"))}
        }

    for node in after.get("nodes", []):
        data = node.get("data") or {}
        if data.get("type") != "tool" or _identity(data) is not None:
            continue
        node_id = str(node.get("id"))
        connected = incident_edges(after, node_id)
        old = old_nodes.get(node_id)
        if connected and (
            old is None
            or (old.get("data") or {}).get("type") != "tool"
            or _identity(old.get("data") or {}) is not None
            or connected != incident_edges(before, node_id)
            or node_id in newly_reachable
        ):
            raise ResourceBindingError("resource_selection_required", node_id, "tool")


def validate_changed_resources(
    before: dict,
    after: dict,
    catalogue: TenantResources,
    *,
    confirmed_ids: Sequence[str] | None = None,
    expected_fingerprints: dict[str, str] | None = None,
    expected_node_resources: dict[str, str] | None = None,
) -> None:
    _validate_unbound_tool_drafts(before, after)
    indexes = {
        "model": {_ref_identity("model", ref): ref for ref in catalogue.models if ref.binding},
        "tool": {_ref_identity("tool", ref): ref for ref in catalogue.tools if ref.binding},
    }
    # Build's public ResourceOption namespace is historically "plugin" for
    # Tool resources. Normalize only that known kind; keep the exact source ID.
    selected = (
        {"tool:" + rid.removeprefix("plugin:") if rid.startswith("plugin:") else rid for rid in confirmed_ids}
        if confirmed_ids is not None
        else None
    )
    nodes = {str(node.get("id")): node for node in changed_resource_nodes(before, after)}
    if expected_node_resources:
        targets = {str(node.get("id")): node for node in after.get("nodes", [])}
        for node_id, rid in expected_node_resources.items():
            node = targets.get(node_id)
            if node is None or _identity(node.get("data") or {}) is None:
                raise ResourceBindingError("resource_selection_required", node_id, rid.split(":", 1)[0])
            nodes[node_id] = node
    for node in nodes.values():
        identity = _identity(node.get("data") or {})
        assert identity is not None
        kind = identity[0]
        ref = indexes[kind].get(identity)
        if ref is None:
            unavailable = catalogue.model_source_error if kind == "model" else catalogue.tool_source_error
            raise ResourceBindingError(
                "resource_catalogue_unavailable" if unavailable else "resource_not_in_catalogue",
                str(node.get("id")),
                kind,
            )
        if kind == "model" and ref.model_contract.get("mode"):
            model_config = (node.get("data") or {}).get("model") or {}
            if model_config.get("mode") != ref.model_contract["mode"]:
                raise ResourceBindingError("resource_configuration_incompatible", str(node.get("id")), kind)
        if kind == "tool" and ref.parameter_contract is not None:
            data = node.get("data") or {}
            actual = {"llm": data.get("tool_parameters") or {}, "form": data.get("tool_configurations") or {}}
            declared = {str(p["name"]): p for p in ref.parameter_contract if p.get("name")}
            for form, values in actual.items():
                if not isinstance(values, dict) or any(
                    key not in declared
                    or (declared[key].get("form") in {"llm", "form"} and declared[key].get("form") != form)
                    for key in values
                ):
                    raise ResourceBindingError("resource_configuration_incompatible", str(node.get("id")), kind)
            if any(
                p.get("form") in {"llm", "form"}
                and p.get("required")
                and not p.get("has_default")
                and str(p["name"]) not in actual.get(str(p.get("form")), {})
                for p in declared.values()
            ):
                raise ResourceBindingError("resource_configuration_incompatible", str(node.get("id")), kind)
        if selected is not None and f"{kind}:{ref.id}" not in selected:
            raise ResourceBindingError("resource_selection_required", str(node.get("id")), kind)
        if expected_node_resources is not None:
            node_id = str(node.get("id"))
            expected = expected_node_resources.get(node_id)
            actual_id = f"{kind}:{ref.id}"
            if expected != actual_id:
                existing_ids = {str(n.get("id")) for n in before.get("nodes", [])}
                kind_choices = {rid for rid in selected or () if rid.startswith(kind + ":")}
                has_target = any(rid.startswith(kind + ":") for rid in expected_node_resources.values())
                # A new node without a planned ID can use a unique selection.
                # Existing/explicit targets and ambiguous new nodes must match.
                if expected is not None or node_id in existing_ids or len(kind_choices) != 1 or has_target:
                    raise ResourceBindingError("resource_selection_required", node_id, kind)
        if expected_fingerprints is not None and expected_fingerprints.get(f"{kind}:{ref.id}") != resource_fingerprint(
            ref
        ):
            raise ResourceBindingError("resource_catalogue_changed", str(node.get("id")), kind)


_RESOURCE_FIELD_PREFIX = "__builder_resource__"
_BINDINGS_RULE = "__builder_resource_bindings"


def _resource_map(catalogue: TenantResources) -> dict[str, ResourceRef]:
    return {
        **{f"model:{ref.id}": ref for ref in catalogue.models},
        **{f"tool:{ref.id}": ref for ref in catalogue.tools},
    }


def resource_fingerprint(ref: ResourceRef) -> str:
    import hashlib
    import json

    raw = json.dumps(
        {
            "binding": ref.binding,
            "availability": ref.availability,
            "declaration_digest": ref.declaration_digest,
            "model_contract": ref.model_contract,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode()).hexdigest()


def _matches(query: str, ref: ResourceRef) -> bool:
    def fold(value: str) -> str:
        return re.sub(r"[\W_]+", "", value.casefold())

    tokens = [fold(token) for token in re.findall(r"\w+(?:[.-]\d+)*", query)]
    candidate = fold(ref.id + " " + ref.label)
    return bool(tokens) and all(token in candidate for token in tokens)


def ground_edit_impact(impact: dict, catalogue: TenantResources) -> dict:
    """Add server-owned actual choices after reconciling model-generated fields."""
    result = dict(impact)
    result["fields"] = [
        field
        for field in impact.get("fields", [])
        if isinstance(field, dict) and not str(field.get("key", "")).startswith("__builder_resource")
    ]
    result["values"] = {
        key: value for key, value in impact.get("values", {}).items() if not key.startswith("__builder_resource")
    }
    directory = _resource_map(catalogue)
    from dataclasses import asdict

    from runtime_contracts.builder.copy_ids import BuilderCopyId
    from runtime_contracts.builder.presentation import copy_text

    for index, request in enumerate(impact.get("resource_requests", [])):
        if (
            not isinstance(request, dict)
            or not isinstance(request.get("kind"), str)
            or request["kind"] not in {"model", "tool"}
        ):
            continue
        kind = request["kind"]
        query = request.get("query") if isinstance(request.get("query"), str) else ""
        # No identity is requested for an explicitly unbound, isolated Tool
        # draft. A named plugin/action or any model still uses normal binding.
        if kind == "tool" and request.get("binding_required") is False and not query and request.get("node_id"):
            continue
        candidates = {rid: ref for rid, ref in directory.items() if rid.startswith(kind + ":")}
        matches = {rid: ref for rid, ref in candidates.items() if _matches(query, ref)}
        options = sorted(matches or candidates)
        key = f"{_RESOURCE_FIELD_PREFIX}{index}"
        node_id = str(request.get("node_id") or "")
        result["fields"].append(
            {
                "key": key,
                "label_copy": asdict(copy_text(BuilderCopyId.RESOURCES_TITLE)),
                "type": "select",
                "required": True,
                "options": options,
                "hint": " · ".join(filter(None, (node_id, query))),
                "resource_kind": kind,
                "resource_node_id": node_id,
                "resource_query": query,
                "resource_fingerprints": {rid: resource_fingerprint(candidates[rid]) for rid in options},
                "source_unavailable": bool(
                    catalogue.model_source_error if kind == "model" else catalogue.tool_source_error
                ),
            }
        )
        result["values"][key] = next(iter(matches)) if len(matches) == 1 else ""
    return result


def resolve_edit_choices(fields: list[dict], rules: dict, catalogue: TenantResources) -> dict:
    directory = _resource_map(catalogue)
    selected: list[str] = []
    bindings: dict[str, dict] = {}
    fingerprints: dict[str, str] = {}
    declarations: dict[str, list[dict] | None] = {}
    node_resources: dict[str, str] = {}
    model_contracts: dict[str, dict] = {}
    for field in fields:
        key = str(field.get("key", ""))
        if not key.startswith(_RESOURCE_FIELD_PREFIX):
            continue
        kind = str(field.get("resource_kind", ""))
        node_id = str(field.get("resource_node_id", ""))
        resource_id = rules.get(key)
        if not isinstance(resource_id, str) or not resource_id:
            raise ResourceBindingError("resource_selection_required", node_id, kind)
        if resource_id not in field.get("options", []) or not resource_id.startswith(kind + ":"):
            raise ResourceBindingError("resource_selection_required", node_id, kind)
        ref = directory.get(resource_id)
        if ref is None:
            unavailable = catalogue.model_source_error if kind == "model" else catalogue.tool_source_error
            raise ResourceBindingError(
                "resource_catalogue_unavailable" if unavailable else "resource_not_in_catalogue", node_id, kind
            )
        expected = field.get("resource_fingerprints", {}).get(resource_id)
        if expected and expected != resource_fingerprint(ref):
            raise ResourceBindingError("resource_catalogue_changed", node_id, kind)
        if node_id:
            if node_id in node_resources and node_resources[node_id] != resource_id:
                raise ResourceBindingError("resource_selection_required", node_id, kind)
            node_resources[node_id] = resource_id
        selected.append(resource_id)
        bindings[key] = dict(ref.binding)
        declarations[key] = ref.parameter_contract
        model_contracts[key] = ref.model_contract
        fingerprints[resource_id] = resource_fingerprint(ref)
    return {
        "resource_ids": selected,
        "bindings": bindings,
        "fingerprints": fingerprints,
        "parameter_contracts": declarations,
        "node_resources": node_resources,
        "model_contracts": model_contracts,
    }


def resolve_plan_resources(agent: Any, context: Any, graph: dict) -> None:
    try:
        resolver = agent.resolve_edit_bindings
    except AttributeError:
        return
    if not callable(resolver):
        return
    selection = resolver(context.form_fields, context.edit_rules, graph)
    context.resource_selection = {**selection, "checked": True}
    if selection.get("bindings"):
        context.edit_rules[_BINDINGS_RULE] = selection["bindings"]
        context.edit_rules["__builder_resource_parameter_contracts"] = selection.get("parameter_contracts", {})
        context.edit_rules["__builder_resource_node_targets"] = selection.get("node_resources", {})
        context.edit_rules["__builder_resource_model_contracts"] = selection.get("model_contracts", {})
    else:
        context.edit_rules.pop(_BINDINGS_RULE, None)
        context.edit_rules.pop("__builder_resource_parameter_contracts", None)
        context.edit_rules.pop("__builder_resource_node_targets", None)
        context.edit_rules.pop("__builder_resource_model_contracts", None)


def selection_failure_step(
    env: Any,
    session: Any,
    context: Any,
    _actor: Any,
    graph: dict,
    progress: Any,
    error: ResourceBindingError,
    *,
    failed_step: str,
) -> Any:
    """Retain failed-plan history and return a fresh, non-executing choice gate."""
    from core.dify_builder.contract import FormCard
    from core.dify_builder.state import PcState
    from runtime_contracts.builder.copy_ids import BuilderCopyId
    from runtime_contracts.builder.presentation import copy_text
    from services.dify_builder import trace_diagnostics
    from services.dify_builder.application.handlers_fix import append_assistant, append_card, build_form_fields
    from services.dify_builder.application.runner import StepResult

    trace_diagnostics.report(
        "validation_refused",
        error=error,
        validation_code=error.reason_code.upper(),
        node_id=error.node_id,
    )
    try:
        refresh = env.agent.refresh_edit_bindings
    except AttributeError:
        refresh = None
    if callable(refresh) and error.reason_code != "resource_configuration_incompatible":
        impact = refresh(
            context.form_fields, context.edit_rules, graph, node_id=error.node_id, kind=error.resource_kind
        )
        context.form_fields = list(impact["fields"])
        context.edit_rules = dict(impact["values"])
    context.resource_selection = {}
    context.staged_repair = []
    context.last_edit_rejection = str(error)
    message = copy_text(
        {
            "resource_catalogue_unavailable": BuilderCopyId.RESOURCES_CATALOGUE_UNAVAILABLE,
            "resource_catalogue_changed": BuilderCopyId.RESOURCES_CHANGED,
        }.get(error.reason_code, BuilderCopyId.RESOURCES_SELECTION_REQUIRED)
    )
    if error.reason_code == "resource_configuration_incompatible":
        message = (
            f"节点 {error.node_id} 的工具或模型配置与已选资源不兼容。尚未应用修改。"
            "请补齐必填配置或修改计划；若只需未配置的工具占位，请明确保持未绑定且不连接。"
            "重复选择同一资源不会补齐配置。"
            if context.reply_language.lower().startswith("zh")
            else f"Node {error.node_id} has configuration incompatible with the selected resource. "
            "Nothing was applied. "
            "Complete the required configuration or revise the plan. An unconfigured Tool draft must remain unbound "
            "and disconnected. Selecting the same resource again does not complete its configuration."
        )
    progress.fail_step(failed_step)
    execution = progress.finish(status="error")
    cards = [
        FormCard(
            variant="edit_rules",
            title=copy_text(BuilderCopyId.FORMS_EDIT_RULES_TITLE),
            description=message,
            fields=build_form_fields(context.form_fields),
            values=dict(context.edit_rules),
            frozen=False,
        ),
    ]
    items = [item for card in cards for item in append_card(context, card)]
    items.extend(append_assistant(env, session, context, message, execution=execution, cards=["form"]))
    return StepResult(next=PcState.EDIT_IMPACT_ANALYSIS, context=context, items=items)


def validate_workspace_resources(
    before: dict,
    after: dict,
    *,
    tenant_id: str,
    account_id: str,
    confirmed_ids: Sequence[str] | None = None,
    expected_fingerprints: dict[str, str] | None = None,
    expected_node_resources: dict[str, str] | None = None,
) -> None:
    """Recheck explicit targets even for an otherwise idempotent/no-op edit."""
    if not expected_node_resources and not changed_resource_nodes(before, after):
        _validate_unbound_tool_drafts(before, after)
        return
    from services.dify_builder.agent.resources import list_tenant_resources

    catalogue = list_tenant_resources(tenant_id, account_id=account_id)
    validate_changed_resources(
        before,
        after,
        catalogue,
        confirmed_ids=confirmed_ids,
        expected_fingerprints=expected_fingerprints,
        expected_node_resources=expected_node_resources,
    )

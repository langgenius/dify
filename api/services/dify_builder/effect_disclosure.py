"""What a Builder Test Run touches outside Dify, and which of it the user confirmed.

PRD §9.1: Test Run defaults to Mock; a real side effect (send, write, create)
runs only after the user saw its target account and object and confirmed it
separately; a destructive operation is never executed by Builder. Model calls,
sandboxed code and read-only calls are disclosed but need no separate
confirmation (they are L2 cost and access, approved with the plan).

Pure: reads one draft graph mapping, account metadata, and optional test inputs. The
classification is deliberately conservative: an unknown node type or a Tool
whose name does not read as a lookup is a side effect, so it is mocked unless
confirmed. A confirmation is bound to the node's effect signature (type,
target, account and constant parameters), so a repair that changes what a node
would touch drops that node's confirmation while unrelated repairs keep it.
"""

import hashlib
import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlsplit

from core.dify_builder.credentials import is_credential_param_key
from core.workflow.nodes.agent_v2.discriminator import is_dify_agent_node_data
from services.dify_builder.revision import node_config_digest, normalize_execution_graph

EffectTier = Literal["pure", "sandboxed", "read", "side_effect", "destructive"]

# Test-data form keys for the per-node confirmation checkboxes. ``:`` never
# appears in a Start variable name, so these keys cannot shadow an input.
CONFIRM_FIELD_PREFIX = "builder_confirm:"

_PURE_TYPES = frozenset(
    {
        "start",
        "end",
        "answer",
        "if-else",
        "variable-aggregator",
        "variable-assigner",
        "assigner",
        "iteration",
        "iteration-start",
        "loop",
        "loop-start",
        "loop-end",
        "list-operator",
        "human-input",
        "trigger-webhook",
        "trigger-schedule",
        "trigger-plugin",
    }
)
_SANDBOXED_TYPES = frozenset({"code", "template-transform"})
_MODEL_TYPES = frozenset({"llm", "question-classifier", "parameter-extractor"})
_READ_TYPES = frozenset({"document-extractor", "knowledge-retrieval"})

_READ_METHODS = frozenset({"get", "head", "options"})
_DESTRUCTIVE_METHODS = frozenset({"delete"})

_DESTRUCTIVE_WORDS = frozenset(
    {"delete", "remove", "drop", "destroy", "purge", "truncate", "erase", "wipe", "trash", "unpublish", "revoke"}
)
_WRITE_WORDS = frozenset(
    {
        "send",
        "post",
        "create",
        "update",
        "write",
        "insert",
        "upsert",
        "add",
        "put",
        "patch",
        "publish",
        "upload",
        "reply",
        "forward",
        "invite",
        "share",
        "set",
        "move",
        "rename",
        "comment",
        "schedule",
        "book",
        "pay",
        "transfer",
        "execute",
        "trigger",
        "deploy",
        "merge",
        "close",
        "assign",
        "label",
        "mark",
        "edit",
        "append",
        "submit",
        "save",
        "notify",
        "tweet",
        "message",
        "email",
        "sms",
        "call",
        "order",
        "cancel",
        "archive",
        "approve",
        "reject",
        "subscribe",
        "unsubscribe",
        "register",
    }
)
_READ_WORDS = frozenset(
    {
        "get",
        "list",
        "search",
        "read",
        "fetch",
        "query",
        "find",
        "lookup",
        "retrieve",
        "download",
        "describe",
        "view",
        "show",
        "check",
        "count",
        "parse",
        "extract",
        "convert",
        "calculate",
        "calc",
        "compute",
        "translate",
        "summarize",
        "analyze",
        "analyse",
        "time",
        "date",
        "weather",
        "scrape",
        "crawl",
        "browse",
        "generate",
        "image",
        "tts",
        "speech",
        "transcribe",
        "ocr",
        "embed",
        "classify",
        "detect",
        "validate",
        "format",
        "encode",
        "decode",
        "hash",
        "random",
        "json",
        "math",
        "eval",
        "wikipedia",
        "arxiv",
        "pubmed",
        "news",
        "stock",
        "price",
        "info",
        "status",
        "profile",
        "export",
    }
)
_WORD_RE = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z0-9]+|[A-Z]+")
_MAX_OBJECT_CHARS = 160


@dataclass(frozen=True)
class EffectItem:
    node_id: str
    title: str
    node_type: str
    tier: EffectTier
    # What the node reaches: model, provider and tool, or method and host.
    target: str
    # Credential display name, or "" when the node uses none or it is unknown.
    account: str
    # Constant parameters naming the object (recipient, channel, URL), truncated.
    object: str
    signature: str
    # Same graph/account snapshot, before direct Start values are bound.
    config_signature: str = ""

    @property
    def confirmable(self) -> bool:
        return self.tier == "side_effect"


@dataclass(frozen=True)
class EffectDisclosure:
    items: tuple[EffectItem, ...] = ()

    def by_tier(self, *tiers: EffectTier) -> tuple[EffectItem, ...]:
        return tuple(item for item in self.items if item.tier in tiers)

    @property
    def confirmable(self) -> tuple[EffectItem, ...]:
        return self.by_tier("side_effect")

    def confirmation(self, node_ids: Iterable[str]) -> dict[str, str]:
        """Bind the confirmed side-effect nodes to their current signatures; others are ignored."""
        wanted = set(node_ids)
        return {item.node_id: item.signature for item in self.confirmable if item.node_id in wanted}

    def mocked_node_ids(self, confirmation: Mapping[str, str] | None) -> frozenset[str]:
        """Unconfirmed side effects, side effects whose target changed since, and every destructive node."""
        confirmed = confirmation or {}
        return frozenset(
            item.node_id
            for item in self.items
            if item.tier == "destructive"
            or (item.tier == "side_effect" and confirmed.get(item.node_id) != item.signature)
        )


def disclose(
    graph: Mapping[str, Any],
    accounts: Mapping[str, str] | None = None,
    *,
    account_bindings: Mapping[str, str] | None = None,
    inputs: Mapping[str, Any] | None = None,
    scope_binding: str = "",
) -> EffectDisclosure:
    """Disclose configuration, resolved accounts, and direct invocation inputs.

    ``account_bindings`` carries opaque resolved credential identities, never
    credential values. Inputs bind Start references and the advanced-chat
    ``sys.query`` input. Upstream outputs cannot be resolved before execution.
    ``scope_binding`` is an adapter-owned digest of environment/conversation
    variable state; its values are never returned as part of the disclosure.
    """
    names = accounts or {}
    bindings = account_bindings or {}
    items: list[EffectItem] = []
    nodes = graph.get("nodes")
    start_ids = (
        {
            str(node["id"])
            for node in nodes
            if isinstance(node, Mapping)
            and isinstance(node.get("id"), str)
            and isinstance(node.get("data"), Mapping)
            and node["data"].get("type") == "start"
        }
        if isinstance(nodes, list)
        else set()
    )
    node_ids = (
        {str(node["id"]) for node in nodes if isinstance(node, Mapping) and isinstance(node.get("id"), str)}
        if isinstance(nodes, list)
        else set()
    )
    start_config = (
        {
            str(node["id"]): node_config_digest(node["data"])
            for node in nodes
            if isinstance(node, Mapping)
            and isinstance(node.get("id"), str)
            and node["id"] in start_ids
            and isinstance(node.get("data"), Mapping)
        }
        if isinstance(nodes, list)
        else {}
    )
    for node in nodes if isinstance(nodes, list) else []:
        if not isinstance(node, Mapping):
            continue
        data = node.get("data")
        node_id = node.get("id")
        if not isinstance(data, Mapping) or not isinstance(node_id, str) or not node_id:
            continue
        node_type = data.get("type")
        if not isinstance(node_type, str) or not node_type:
            continue
        bound_inputs = _referenced_start_inputs(data, start_ids, inputs) if inputs is not None else {}
        upstream = _has_upstream_reference(data, node_ids - start_ids)
        # An upstream value is unknowable before execution. Conservatively bind
        # dynamic effects to the graph configuration, while fixed targets keep
        # their existing per-node binding through unrelated repairs.
        # An omitted Start input may use its declared default at runtime, so
        # bind the declaration as well as the submitted input values.
        input_references = _referenced_start_inputs(data, start_ids, {})
        graph_binding = (
            normalize_execution_graph(dict(graph))
            if upstream
            else ({"start_config": start_config} if input_references else None)
        )
        if upstream and inputs is not None:
            bound_inputs.update(_referenced_start_inputs(graph, start_ids, inputs))
        display_data = _resolve_input_references(data, start_ids, inputs) if inputs is not None else data
        tier, target, obj = _classify(node_type, display_data)
        if upstream:
            obj = "; ".join(
                part for part in (obj, "Some values come from upstream outputs and resolve during Test Run.") if part
            )
        account = names.get(node_id, "")
        config_tier, config_target, _ = _classify(node_type, data)
        title = data.get("title") if isinstance(data.get("title"), str) else ""
        items.append(
            EffectItem(
                node_id=node_id,
                title=title or node_id,
                node_type=node_type,
                tier=tier,
                target=target,
                account=account,
                object=obj,
                signature=_signature(
                    node_type,
                    tier,
                    target,
                    data,
                    account,
                    bindings.get(node_id, ""),
                    bound_inputs,
                    graph_binding,
                    scope_binding,
                ),
                config_signature=_signature(
                    node_type,
                    config_tier,
                    config_target,
                    data,
                    account,
                    bindings.get(node_id, ""),
                    {},
                    graph_binding,
                    scope_binding,
                ),
            )
        )
    return EffectDisclosure(items=tuple(items))


_VARIABLE_REF = re.compile(r"\{\{#([^#]+)#\}\}")


def _has_upstream_reference(value: object, upstream_ids: set[str]) -> bool:
    if isinstance(value, Mapping):
        return any(_has_upstream_reference(child, upstream_ids) for child in value.values())
    if isinstance(value, (list, tuple)):
        if len(value) >= 2 and isinstance(value[0], str) and value[0] in upstream_ids:
            return True
        return any(_has_upstream_reference(child, upstream_ids) for child in value)
    if isinstance(value, str):
        return any(match.group(1).split(".", 1)[0] in upstream_ids for match in _VARIABLE_REF.finditer(value))
    return False


def _input_selector(value: object, start_ids: set[str]) -> str | None:
    if isinstance(value, (tuple, list)) and list(value) == ["sys", "query"]:
        return "sys.query"
    if (
        isinstance(value, (tuple, list))
        and len(value) >= 2
        and isinstance(value[0], str)
        and value[0] in start_ids
        and isinstance(value[1], str)
    ):
        return value[1]
    return None


def _input_reference_value(selector: object, start_ids: set[str], inputs: Mapping[str, Any]) -> tuple[bool, Any]:
    """Read public mapping/list paths only; never evaluate code or object attributes."""
    name = _input_selector(selector, start_ids)
    if name is None or name not in inputs or not isinstance(selector, (list, tuple)):
        return False, None
    value = inputs[name]
    for part in selector[2:]:
        if isinstance(value, Mapping) and isinstance(part, str) and part in value:
            value = value[part]
        elif isinstance(value, list) and isinstance(part, str) and part.isdecimal() and int(part) < len(value):
            value = value[int(part)]
        else:
            return False, None
    return True, value


def _referenced_start_inputs(value: object, start_ids: set[str], inputs: Mapping[str, Any]) -> dict[str, Any]:
    referenced: dict[str, Any] = {}
    if isinstance(value, Mapping):
        selector = _input_selector(value.get("value"), start_ids) if value.get("type") == "variable" else None
        if selector is not None:
            referenced[selector] = inputs.get(selector)
        for child in value.values():
            referenced.update(_referenced_start_inputs(child, start_ids, inputs))
    elif isinstance(value, (list, tuple)):
        selector = _input_selector(value, start_ids)
        if selector is not None:
            referenced[selector] = inputs.get(selector)
        for child in value:
            referenced.update(_referenced_start_inputs(child, start_ids, inputs))
    elif isinstance(value, str):
        for match in _VARIABLE_REF.finditer(value):
            selector = _input_selector(match.group(1).split("."), start_ids)
            if selector is not None:
                referenced[selector] = inputs.get(selector)
    return referenced


def _resolve_input_references(value: Any, start_ids: set[str], inputs: Mapping[str, Any]) -> Any:
    """Resolve known Start/query references for display, without executing a graph."""
    if isinstance(value, Mapping):
        found, resolved = (
            _input_reference_value(value.get("value"), start_ids, inputs)
            if value.get("type") == "variable"
            else (False, None)
        )
        if found:
            return {**value, "type": "constant", "value": resolved}
        return {key: _resolve_input_references(child, start_ids, inputs) for key, child in value.items()}
    if isinstance(value, list):
        return [_resolve_input_references(child, start_ids, inputs) for child in value]
    if isinstance(value, str):

        def replace(match: re.Match[str]) -> str:
            found, resolved = _input_reference_value(match.group(1).split("."), start_ids, inputs)
            return str(resolved) if found else match.group(0)

        return _VARIABLE_REF.sub(replace, value)
    return value


def split_confirmations(inputs: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Separate the test-data form's confirmation checkboxes from the Start inputs."""
    plain: dict[str, Any] = {}
    confirmed: list[str] = []
    for key, value in inputs.items():
        if isinstance(key, str) and key.startswith(CONFIRM_FIELD_PREFIX):
            if value is True:
                confirmed.append(key.removeprefix(CONFIRM_FIELD_PREFIX))
            continue
        plain[key] = value
    return plain, confirmed


def confirm_field_key(node_id: str) -> str:
    return CONFIRM_FIELD_PREFIX + node_id


def _classify(node_type: str, data: Mapping[str, Any]) -> tuple[EffectTier, str, str]:
    if node_type in _PURE_TYPES:
        return "pure", "", ""
    if node_type in _SANDBOXED_TYPES:
        return "sandboxed", "", ""
    if node_type in _MODEL_TYPES:
        return "read", _model_target(data), ""
    if node_type in _READ_TYPES:
        return "read", "", ""
    if node_type == "http-request":
        return _http(data)
    if node_type == "tool":
        return _tool(data)
    if node_type == "agent" and is_dify_agent_node_data(data):
        return _agent_v2(data)
    # Agents may call any tool; datasource/indexing and unknown types are not
    # Workflow test material. All of them need an explicit confirmation.
    return "side_effect", _model_target(data) or node_type, ""


def _agent_v2(data: Mapping[str, Any]) -> tuple[EffectTier, str, str]:
    """Name the selected graph binding without predicting nested runtime actions."""
    target = "Dify Agent (binding unavailable)"
    binding = data.get("agent_binding")
    if isinstance(binding, Mapping):
        agent_id, snapshot_id = binding.get("agent_id"), binding.get("current_snapshot_id")
        if isinstance(agent_id, str) and agent_id.strip() and isinstance(snapshot_id, str) and snapshot_id.strip():
            target = _truncate(f"Agent {agent_id} / snapshot {snapshot_id}")
    return (
        "side_effect",
        target,
        "May use its configured model and tools. Nested runtime targets cannot be predicted from this outer node.",
    )


def _model_target(data: Mapping[str, Any]) -> str:
    model = data.get("model")
    if isinstance(model, Mapping):
        provider = str(model.get("provider") or "").rsplit("/", 1)[-1]
        name = str(model.get("name") or "")
        return " / ".join(part for part in (provider, name) if part)
    return ""


def _http(data: Mapping[str, Any]) -> tuple[EffectTier, str, str]:
    method = str(data.get("method") or "get").lower()
    url = str(data.get("url") or "")
    host = _host(url)
    target = f"{method.upper()} {host}".strip()
    obj = _truncate(url)
    if method in _READ_METHODS:
        return "read", target, obj
    if method in _DESTRUCTIVE_METHODS:
        return "destructive", target, obj
    return "side_effect", target, obj


def _host(url: str) -> str:
    if "{{#" in url:
        # A host taken from a variable is shown as written.
        return url.split("://", 1)[-1].split("/", 1)[0]
    try:
        return urlsplit(url).hostname or url
    except ValueError:
        return url


def _tool(data: Mapping[str, Any]) -> tuple[EffectTier, str, str]:
    provider_type = str(data.get("provider_type") or "")
    provider = str(data.get("provider_name") or data.get("provider_id") or "").rsplit("/", 1)[-1]
    tool_name = str(data.get("tool_name") or "")
    tool_label = str(data.get("tool_label") or tool_name)
    target = " / ".join(part for part in (provider, tool_label) if part)
    obj = _constant_parameters(data.get("tool_parameters"))
    if provider_type in {"workflow", "app"}:
        # A child workflow or app can do anything its own graph does.
        return "side_effect", target, obj
    words = _words(tool_name) or _words(tool_label)
    if words & _DESTRUCTIVE_WORDS:
        return "destructive", target, obj
    if words & _WRITE_WORDS:
        return "side_effect", target, obj
    if words & _READ_WORDS or provider_type == "dataset-retrieval":
        return "read", target, obj
    return "side_effect", target, obj


def _words(name: str) -> set[str]:
    words: set[str] = set()
    for part in re.split(r"[^A-Za-z0-9]+", name):
        words.update(match.lower() for match in _WORD_RE.findall(part))
    return words


def _constant_parameters(parameters: object) -> str:
    if not isinstance(parameters, Mapping):
        return ""
    shown: list[str] = []
    for key in sorted(parameters):
        value = parameters[key]
        if isinstance(value, Mapping):
            if value.get("type") not in {"constant", "mixed"}:
                continue
            value = value.get("value")
        if isinstance(value, (str, int, float, bool)) and str(value).strip() and not is_credential_param_key(str(key)):
            shown.append(f"{key}={value}")
    return _truncate(", ".join(shown))


def _truncate(text: str) -> str:
    return text if len(text) <= _MAX_OBJECT_CHARS else text[: _MAX_OBJECT_CHARS - 1] + "…"


def _signature(
    node_type: str,
    tier: EffectTier,
    target: str,
    data: Mapping[str, Any],
    account: str,
    account_binding: str,
    bound_inputs: Mapping[str, Any],
    graph_binding: Mapping[str, Any] | None,
    scope_binding: str,
) -> str:
    material: dict[str, Any] = {
        "type": node_type,
        "tier": tier,
        "target": target,
        "account": account,
        "account_binding": account_binding,
        "inputs": bound_inputs,
        "dynamic_graph": graph_binding,
        "scope_binding": scope_binding,
    }
    # Bind all executable configuration, including HTTP headers and Tool form
    # configurations. A field allowlist can silently miss a new target/account
    # setting. Reuse the execution revision's canvas exclusions.
    material["data"] = node_config_digest({key: value for key, value in data.items() if key not in {"title", "desc"}})
    encoded = json.dumps(material, sort_keys=True, ensure_ascii=False, default=str).encode()
    return hashlib.sha256(encoded).hexdigest()

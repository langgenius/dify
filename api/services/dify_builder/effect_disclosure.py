"""What a Builder Test Run touches outside Dify, and which of it the user confirmed.

PRD §9.1: Test Run defaults to Mock; a real side effect (send, write, create)
runs only after the user saw its target account and object and confirmed it
separately; a destructive operation is never executed by Builder. Model calls,
sandboxed code and read-only calls are disclosed but need no separate
confirmation (they are L2 cost and access, approved with the plan).

Pure: reads one draft graph mapping and an optional account-name lookup. The
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


def disclose(graph: Mapping[str, Any], accounts: Mapping[str, str] | None = None) -> EffectDisclosure:
    """Classify every node of ``graph``; ``accounts`` maps a node ID to its credential display name."""
    names = accounts or {}
    items: list[EffectItem] = []
    nodes = graph.get("nodes")
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
        tier, target, obj = _classify(node_type, data)
        account = names.get(node_id, "")
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
                signature=_signature(node_type, tier, target, data),
            )
        )
    return EffectDisclosure(items=tuple(items))


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
    # Agents may call any tool; datasource/indexing and unknown types are not
    # Workflow test material. All of them need an explicit confirmation.
    return "side_effect", _model_target(data) or node_type, ""


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


def _signature(node_type: str, tier: EffectTier, target: str, data: Mapping[str, Any]) -> str:
    material: dict[str, Any] = {"type": node_type, "tier": tier, "target": target}
    if node_type == "tool":
        for key in ("provider_id", "provider_type", "tool_name", "credential_id", "tool_parameters"):
            material[key] = data.get(key)
    elif node_type == "http-request":
        for key in ("method", "url", "params", "body", "authorization"):
            material[key] = data.get(key)
    else:
        material["data"] = {key: value for key, value in data.items() if key not in {"title", "desc", "selected"}}
    encoded = json.dumps(material, sort_keys=True, ensure_ascii=False, default=str).encode()
    return hashlib.sha256(encoded).hexdigest()

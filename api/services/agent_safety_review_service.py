from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import socket
from dataclasses import dataclass
from enum import StrEnum
from typing import Any
from urllib.parse import unquote, urlsplit

from models.workflow import Workflow


class SafetySeverity(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AgentSafetyReviewBlockedError(ValueError):
    def __init__(self, report: dict[str, Any]) -> None:
        self.report = report
        super().__init__("Agent safety review blocked this publish.")


@dataclass(frozen=True)
class SafetyFinding:
    rule_id: str
    severity: SafetySeverity
    title: str
    message: str
    node_id: str | None = None
    node_type: str | None = None
    remediation: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = {
            "rule_id": self.rule_id,
            "severity": self.severity.value,
            "title": self.title,
            "message": self.message,
        }
        if self.node_id:
            payload["node_id"] = self.node_id
        if self.node_type:
            payload["node_type"] = self.node_type
        if self.remediation:
            payload["remediation"] = self.remediation
        return payload


class AgentSafetyReviewService:
    """Pre-publish safety gate for agent/workflow changes.

    The first implementation is deterministic and local. It deliberately does
    not call an LLM, so publish behavior is repeatable and testable.
    """

    BLOCKING_SEVERITIES = {SafetySeverity.HIGH, SafetySeverity.CRITICAL}
    SECRET_NAME_RE = re.compile(r"(api[_-]?key|token|secret|password|credential)", re.IGNORECASE)
    PROMPT_INJECTION_RE = re.compile(
        r"(ignore (all )?(previous|above) instructions|bypass|jailbreak|reveal.*system prompt|developer message)",
        re.IGNORECASE,
    )

    @classmethod
    def review_workflow(cls, *, workflow: Workflow, app_id: str | None = None) -> dict[str, Any]:
        graph = _workflow_graph_dict(workflow)
        nodes = graph.get("nodes", [])
        if not isinstance(nodes, list):
            findings = [
                SafetyFinding(
                    rule_id="graph.nodes.invalid",
                    severity=SafetySeverity.CRITICAL,
                    title="Invalid graph shape",
                    message="Workflow graph nodes must be a list before publish.",
                    remediation="Sync a valid draft workflow graph before publishing.",
                )
            ]
            return cls._build_report(workflow=workflow, app_id=app_id, findings=findings)

        findings: list[SafetyFinding] = []
        node_types = {_node_type(node) for node in nodes}
        approval_graph = ApprovalPathAnalyzer(graph=graph, nodes=nodes)
        allowlist = _agent_safety_allowed_domains(workflow=workflow, graph=graph)

        for node in nodes:
            node_id = str(node.get("id") or node.get("node_id") or "unknown")
            data = node.get("data") if isinstance(node.get("data"), dict) else {}
            node_type = _node_type(node)

            findings.extend(cls._review_prompt_text(node_id=node_id, node_type=node_type, data=data))

            if node_type in {"http-request", "http"}:
                findings.extend(
                    cls._review_http_node(
                        node_id=node_id,
                        node_type=node_type,
                        data=data,
                        allowed_domains=allowlist,
                    )
                )
            elif node_type == "code":
                has_required_approval = approval_graph.has_approval_before_downstream_action(node_id) or (
                    approval_graph.has_approval_before_node(node_id)
                )
                findings.append(
                    SafetyFinding(
                        rule_id="code.execution.requires_review",
                        severity=SafetySeverity.MEDIUM if has_required_approval else SafetySeverity.HIGH,
                        title="Code execution before publish",
                        message=(
                            "Code nodes can transform data or call external services "
                            "in ways that are hard to audit."
                        ),
                        node_id=node_id,
                        node_type=node_type,
                        remediation="Add a human review node before production output, or remove the code node.",
                    )
                )
                if not has_required_approval:
                    findings.append(_missing_approval_finding(node_id=node_id, node_type=node_type))
            elif "agent" in node_type:
                findings.extend(
                    cls._review_agent_node(
                        node_id=node_id,
                        node_type=node_type,
                        data=data,
                        has_required_approval=approval_graph.has_approval_before_node(node_id),
                    )
                )

        findings.extend(
            cls._review_variables(
                workflow=workflow,
                node_types=node_types,
                has_human_review=approval_graph.has_any_approval,
            )
        )
        return cls._build_report(workflow=workflow, app_id=app_id, findings=findings)

    @classmethod
    def assert_workflow_safe_for_publish(cls, *, workflow: Workflow, app_id: str | None = None) -> dict[str, Any]:
        report = cls.review_workflow(workflow=workflow, app_id=app_id)
        if report["decision"] == "blocked":
            raise AgentSafetyReviewBlockedError(report)
        return report

    @classmethod
    def _review_prompt_text(cls, *, node_id: str, node_type: str, data: dict[str, Any]) -> list[SafetyFinding]:
        findings: list[SafetyFinding] = []
        for prompt_text in _iter_prompt_texts(data):
            if cls.PROMPT_INJECTION_RE.search(prompt_text):
                findings.append(
                    SafetyFinding(
                        rule_id="prompt.injection.suspicious_text",
                        severity=SafetySeverity.HIGH,
                        title="Suspicious prompt-injection wording",
                        message="The draft contains wording commonly used to bypass higher-priority instructions.",
                        node_id=node_id,
                        node_type=node_type,
                        remediation=(
                            "Remove jailbreak/bypass wording or isolate it as test data "
                            "that cannot reach the agent prompt."
                        ),
                    )
                )
        return findings

    @classmethod
    def _review_http_node(
        cls, *, node_id: str, node_type: str, data: dict[str, Any], allowed_domains: set[str]
    ) -> list[SafetyFinding]:
        findings = [
            SafetyFinding(
                rule_id="http.outbound.present",
                severity=SafetySeverity.MEDIUM,
                title="Outbound HTTP request",
                message="HTTP request nodes can exfiltrate prompt, user, or tool data.",
                node_id=node_id,
                node_type=node_type,
                remediation="Use an allowlisted connector and avoid sending secrets or raw conversation content.",
            )
        ]
        url_text = _string_value(data.get("url") or data.get("url_template") or "")
        if _is_dynamic_value(url_text):
            findings.append(
                SafetyFinding(
                    rule_id="http.dynamic_url",
                    severity=SafetySeverity.HIGH,
                    title="Dynamic outbound URL",
                    message="The HTTP target appears to be influenced by runtime variables.",
                    node_id=node_id,
                    node_type=node_type,
                    remediation="Constrain the domain with an allowlist before publishing.",
                )
            )

        url_review = UrlSafetyAnalyzer.review(url_text=url_text, allowed_domains=allowed_domains)
        findings.extend(_url_findings_to_safety_findings(node_id=node_id, node_type=node_type, reviews=url_review))

        redirect_reviews = UrlSafetyAnalyzer.review_redirects(
            redirect_urls=_extract_redirect_urls(data),
            allowed_domains=allowed_domains,
        )
        findings.extend(
            _url_findings_to_safety_findings(
                node_id=node_id,
                node_type=node_type,
                reviews=redirect_reviews,
            )
        )

        if cls.SECRET_NAME_RE.search(json.dumps(_http_sensitive_fields(data), ensure_ascii=False, default=str)):
            findings.append(
                SafetyFinding(
                    rule_id="http.secret_reference",
                    severity=SafetySeverity.HIGH,
                    title="HTTP node may reference secrets",
                    message="The HTTP node appears to use API keys, tokens, passwords, or credentials.",
                    node_id=node_id,
                    node_type=node_type,
                    remediation=(
                        "Confirm secrets are only sent to approved domains and "
                        "never included in prompts or logs."
                    ),
                )
            )
        return findings

    @classmethod
    def _review_agent_node(
        cls, *, node_id: str, node_type: str, data: dict[str, Any], has_required_approval: bool
    ) -> list[SafetyFinding]:
        findings: list[SafetyFinding] = []
        if _agent_has_tools(data):
            findings.append(
                SafetyFinding(
                    rule_id="agent.tools.require_review",
                    severity=SafetySeverity.MEDIUM if has_required_approval else SafetySeverity.HIGH,
                    title="Agent tool use needs release review",
                    message="The agent can call tools after publish, but no proven approval path was detected.",
                    node_id=node_id,
                    node_type=node_type,
                    remediation="Add a human review/approval node for tool-using agent flows before external action.",
                )
            )
            if not has_required_approval:
                findings.append(_missing_approval_finding(node_id=node_id, node_type=node_type))
        strategy = data.get("agent_strategy") or data.get("strategy")
        if isinstance(strategy, str) and strategy.lower() in {"react", "function_calling"}:
            findings.append(
                SafetyFinding(
                    rule_id="agent.autonomous_strategy",
                    severity=SafetySeverity.MEDIUM,
                    title="Autonomous agent strategy",
                    message=f"Agent strategy `{strategy}` may perform multi-step tool use.",
                    node_id=node_id,
                    node_type=node_type,
                    remediation="Set tool limits, add monitoring, and keep high-impact tools behind approval.",
                )
            )
        return findings

    @classmethod
    def _review_variables(
        cls, *, workflow: Workflow, node_types: set[str], has_human_review: bool
    ) -> list[SafetyFinding]:
        findings: list[SafetyFinding] = []
        risky_nodes = bool({"http-request", "http", "code"} & node_types) or any(
            "agent" in node_type for node_type in node_types
        )
        variables = []
        variables.extend(getattr(workflow, "environment_variables", None) or [])
        variables.extend(getattr(workflow, "conversation_variables", None) or [])
        for variable in variables:
            if not isinstance(variable, dict):
                continue
            name = str(variable.get("name") or variable.get("variable") or "")
            value_type = str(variable.get("value_type") or variable.get("type") or "")
            if value_type == "secret" or cls.SECRET_NAME_RE.search(name):
                findings.append(
                    SafetyFinding(
                        rule_id="secret.variable.with_risky_nodes" if risky_nodes else "secret.variable.present",
                        severity=SafetySeverity.HIGH if risky_nodes and not has_human_review else SafetySeverity.MEDIUM,
                        title="Sensitive variable in publish diff",
                        message=f"Variable `{name or 'unnamed'}` appears sensitive.",
                        remediation=(
                            "Verify the variable is masked, scoped to approved nodes, "
                            "and not sent to prompts/logs."
                        ),
                    )
                )
        return findings

    @classmethod
    def _build_report(cls, *, workflow: Workflow, app_id: str | None, findings: list[SafetyFinding]) -> dict[str, Any]:
        finding_dicts = [finding.to_dict() for finding in findings]
        blocking_severities = {severity.value for severity in cls.BLOCKING_SEVERITIES}
        blocking = [item for item in finding_dicts if item["severity"] in blocking_severities]
        graph_json = json.dumps(_workflow_graph_dict(workflow), sort_keys=True, default=str)
        graph_hash = hashlib.sha256(graph_json.encode()).hexdigest()
        return {
            "plugin": "agent-safety-review",
            "version": "0.1.0",
            "decision": "blocked" if blocking else "approved",
            "app_id": app_id or getattr(workflow, "app_id", None),
            "workflow_id": getattr(workflow, "id", None),
            "workflow_version": getattr(workflow, "version", None),
            "graph_hash": graph_hash,
            "summary": {
                "total_findings": len(finding_dicts),
                "blocking_findings": len(blocking),
                "critical": sum(1 for item in finding_dicts if item["severity"] == SafetySeverity.CRITICAL.value),
                "high": sum(1 for item in finding_dicts if item["severity"] == SafetySeverity.HIGH.value),
                "medium": sum(1 for item in finding_dicts if item["severity"] == SafetySeverity.MEDIUM.value),
                "low": sum(1 for item in finding_dicts if item["severity"] == SafetySeverity.LOW.value),
            },
            "findings": finding_dicts,
        }


def _node_type(node: dict[str, Any]) -> str:
    data = node.get("data") if isinstance(node.get("data"), dict) else {}
    value = data.get("type") or node.get("type") or ""
    return str(value).lower()


def _workflow_graph_dict(workflow: Workflow) -> dict[str, Any]:
    graph = getattr(workflow, "graph_dict", None)
    if isinstance(graph, dict):
        return graph

    graph = getattr(workflow, "graph", None)
    if isinstance(graph, dict):
        return graph

    return {"nodes": "invalid"}


@dataclass(frozen=True)
class UrlReviewFinding:
    rule_id: str
    severity: SafetySeverity
    title: str
    message: str
    remediation: str


class UrlSafetyAnalyzer:
    DYNAMIC_MARKERS = ("{{", "#sys.", "#conversation.", "#context.", "#env.")

    @classmethod
    def review(cls, *, url_text: str, allowed_domains: set[str]) -> list[UrlReviewFinding]:
        if not url_text or _is_dynamic_value(url_text):
            return []

        normalized = _repeated_unquote(url_text.strip())
        parsed = urlsplit(normalized)
        if parsed.scheme not in {"http", "https"}:
            if parsed.scheme:
                return [
                    UrlReviewFinding(
                        rule_id="url.disallowed_scheme",
                        severity=SafetySeverity.CRITICAL,
                        title="Disallowed URL scheme",
                        message=f"URL scheme `{parsed.scheme}` is not allowed for HTTP request nodes.",
                        remediation="Use HTTPS endpoints or an approved connector for non-HTTP resources.",
                    )
                ]
            return []

        host = (parsed.hostname or "").strip().lower().rstrip(".")
        if not host:
            return []

        findings: list[UrlReviewFinding] = []
        if allowed_domains and not _host_allowed(host=host, allowed_domains=allowed_domains):
            findings.append(
                UrlReviewFinding(
                    rule_id="http.host_not_allowlisted",
                    severity=SafetySeverity.HIGH,
                    title="HTTP host is not allowlisted",
                    message=f"Host `{host}` is not in the configured agent safety allowlist.",
                    remediation="Add the domain to the allowlist or route this call through an approved connector.",
                )
            )

        literal_ip = _parse_ip_literal(host)
        if literal_ip is not None:
            if _is_unsafe_ip(literal_ip):
                findings.append(_private_url_finding(host))
            return findings

        resolved_ips = _resolve_hostname(host)
        if not resolved_ips:
            return findings

        unsafe_ips = [ip for ip in resolved_ips if _is_unsafe_ip(ip)]
        public_ips = [ip for ip in resolved_ips if not _is_unsafe_ip(ip)]
        if unsafe_ips and public_ips:
            findings.append(
                UrlReviewFinding(
                    rule_id="url.dns_rebinding",
                    severity=SafetySeverity.CRITICAL,
                    title="DNS rebinding risk",
                    message=f"Host `{host}` resolves to both public and private/local addresses.",
                    remediation="Pin this integration to an allowlisted connector with DNS rebinding protection.",
                )
            )
        elif unsafe_ips:
            findings.append(_private_url_finding(host))

        return findings

    @classmethod
    def review_redirects(cls, *, redirect_urls: list[str], allowed_domains: set[str]) -> list[UrlReviewFinding]:
        findings: list[UrlReviewFinding] = []
        for redirect_url in redirect_urls:
            for finding in cls.review(url_text=redirect_url, allowed_domains=allowed_domains):
                if finding.rule_id == "url.private_target":
                    findings.append(
                        UrlReviewFinding(
                            rule_id="url.redirect_private_target",
                            severity=finding.severity,
                            title="Redirect targets a private/internal address",
                            message=f"Redirect URL `{redirect_url}` points to a private, local, or metadata target.",
                            remediation="Disable redirects or constrain redirects to approved public domains.",
                        )
                    )
                else:
                    findings.append(finding)
        return findings


class ApprovalPathAnalyzer:
    def __init__(self, *, graph: dict[str, Any], nodes: list[dict[str, Any]]) -> None:
        self.node_types = {_node_id(node): _node_type(node) for node in nodes}
        self.approval_nodes = {_node_id(node) for node in nodes if _is_human_review_node(node)}
        self.has_any_approval = bool(self.approval_nodes)
        self.adjacency: dict[str, list[str]] = {node_id: [] for node_id in self.node_types}
        self.incoming: dict[str, set[str]] = {node_id: set() for node_id in self.node_types}

        for edge in graph.get("edges", []) if isinstance(graph.get("edges", []), list) else []:
            if not isinstance(edge, dict):
                continue
            source = edge.get("source") or edge.get("source_node_id")
            target = edge.get("target") or edge.get("target_node_id")
            if not source or not target:
                continue
            source_id = str(source)
            target_id = str(target)
            self.adjacency.setdefault(source_id, []).append(target_id)
            self.incoming.setdefault(target_id, set()).add(source_id)

    def has_approval_before_node(self, node_id: str) -> bool:
        if not self.has_any_approval:
            return False

        starts = [candidate for candidate in self.node_types if not self.incoming.get(candidate)]
        if not starts:
            starts = list(self.node_types)

        stack = [(start, start in self.approval_nodes) for start in starts]
        visited: set[tuple[str, bool]] = set()
        while stack:
            current, approval_seen = stack.pop()
            state = (current, approval_seen)
            if state in visited:
                continue
            visited.add(state)
            if current == node_id:
                if not approval_seen:
                    return False
                continue
            next_approval_seen = approval_seen or current in self.approval_nodes
            for neighbor in self.adjacency.get(current, []):
                stack.append((neighbor, next_approval_seen or neighbor in self.approval_nodes))

        return True

    def has_approval_before_downstream_action(self, node_id: str) -> bool:
        if not self.has_any_approval:
            return False

        stack = [(neighbor, neighbor in self.approval_nodes) for neighbor in self.adjacency.get(node_id, [])]
        if not stack:
            return False

        visited: set[tuple[str, bool]] = set()
        action_reached = False
        while stack:
            current, approval_seen = stack.pop()
            state = (current, approval_seen)
            if state in visited:
                continue
            visited.add(state)
            next_approval_seen = approval_seen or current in self.approval_nodes
            if _is_external_action_node_type(self.node_types.get(current, "")):
                action_reached = True
                if not next_approval_seen:
                    return False
                continue
            for neighbor in self.adjacency.get(current, []):
                stack.append((neighbor, next_approval_seen or neighbor in self.approval_nodes))

        return action_reached


def _is_human_review_node(node: dict[str, Any]) -> bool:
    node_type = _node_type(node)
    if node_type in {"human-input", "human_input", "approval", "review"}:
        return True
    serialized = json.dumps(node, ensure_ascii=False, default=str).lower()
    return "human" in serialized and ("approval" in serialized or "review" in serialized)


def _node_id(node: dict[str, Any]) -> str:
    return str(node.get("id") or node.get("node_id") or "unknown")


def _missing_approval_finding(*, node_id: str, node_type: str) -> SafetyFinding:
    return SafetyFinding(
        rule_id="approval.path.missing",
        severity=SafetySeverity.HIGH,
        title="Approval path is not proven",
        message="A risky node can reach production output or external action without passing approval.",
        node_id=node_id,
        node_type=node_type,
        remediation="Route every path from the risky node through a human approval node before external action.",
    )


def _url_findings_to_safety_findings(
    *, node_id: str, node_type: str, reviews: list[UrlReviewFinding]
) -> list[SafetyFinding]:
    return [
        SafetyFinding(
            rule_id=review.rule_id,
            severity=review.severity,
            title=review.title,
            message=review.message,
            node_id=node_id,
            node_type=node_type,
            remediation=review.remediation,
        )
        for review in reviews
    ]


def _private_url_finding(host: str) -> UrlReviewFinding:
    return UrlReviewFinding(
        rule_id="url.private_target",
        severity=SafetySeverity.CRITICAL,
        title="Private or internal URL target",
        message=f"Host `{host}` resolves to a private, local, reserved, or metadata-service address.",
        remediation="Use an approved public endpoint or an SSRF-protected connector.",
    )


def _iter_prompt_texts(data: dict[str, Any]) -> list[str]:
    prompt_fields = (
        "prompt",
        "prompt_template",
        "system_prompt",
        "instruction",
        "instructions",
        "pre_prompt",
        "query",
        "context",
    )
    texts: list[str] = []
    for field in prompt_fields:
        if field in data:
            texts.extend(_collect_strings(data[field]))

    model_config = data.get("model_config")
    if isinstance(model_config, dict):
        for field in prompt_fields:
            if field in model_config:
                texts.extend(_collect_strings(model_config[field]))

    return texts


def _collect_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        texts: list[str] = []
        for nested_value in value.values():
            texts.extend(_collect_strings(nested_value))
        return texts
    if isinstance(value, list):
        texts = []
        for item in value:
            texts.extend(_collect_strings(item))
        return texts
    return []


def _http_sensitive_fields(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "authorization": data.get("authorization"),
        "headers": data.get("headers"),
        "params": data.get("params"),
        "body": data.get("body"),
    }


def _agent_has_tools(data: dict[str, Any]) -> bool:
    tools = data.get("tools")
    if isinstance(tools, list):
        return len(tools) > 0
    if isinstance(tools, dict):
        return bool(tools)
    tool_configs = data.get("tool_configs") or data.get("agent_tools")
    if isinstance(tool_configs, (list, dict)):
        return bool(tool_configs)
    return False


def _is_external_action_node_type(node_type: str) -> bool:
    return node_type in {"http-request", "http", "tool", "end", "answer"} or "agent" in node_type


def _string_value(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        if isinstance(value.get("value"), str):
            return value["value"]
        if isinstance(value.get("text"), str):
            return value["text"]
    return ""


def _is_dynamic_value(value: str) -> bool:
    return any(marker in value for marker in UrlSafetyAnalyzer.DYNAMIC_MARKERS)


def _extract_redirect_urls(data: dict[str, Any]) -> list[str]:
    redirect_values: list[Any] = []
    for key in ("redirect_url", "redirect_urls", "redirects", "allowed_redirects"):
        if key in data:
            redirect_values.append(data[key])

    urls: list[str] = []
    for value in redirect_values:
        if isinstance(value, str):
            urls.append(value)
        elif isinstance(value, list):
            urls.extend(item for item in value if isinstance(item, str))
        elif isinstance(value, dict):
            urls.extend(item for item in value.values() if isinstance(item, str))
    return urls


def _agent_safety_allowed_domains(*, workflow: Workflow, graph: dict[str, Any]) -> set[str]:
    candidates: list[Any] = []
    for container in (
        getattr(workflow, "features_dict", None),
        getattr(workflow, "features", None),
        graph,
    ):
        if isinstance(container, dict):
            candidates.append(container.get("agent_safety_review"))
            candidates.append(container.get("agentSafetyReview"))

    domains: set[str] = set()
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        raw_domains = candidate.get("allowed_domains") or candidate.get("allowlist") or candidate.get("allowed_hosts")
        if isinstance(raw_domains, str):
            raw_domains = [raw_domains]
        if isinstance(raw_domains, list):
            for domain in raw_domains:
                if isinstance(domain, str) and domain.strip():
                    domains.add(domain.strip().lower().rstrip("."))
    return domains


def _host_allowed(*, host: str, allowed_domains: set[str]) -> bool:
    for domain in allowed_domains:
        if domain.startswith("*.") and host.endswith(domain[1:]):
            return True
        if domain.startswith(".") and host.endswith(domain):
            return True
        if host == domain:
            return True
    return False


def _repeated_unquote(value: str) -> str:
    decoded = value
    for _ in range(3):
        next_decoded = unquote(decoded)
        if next_decoded == decoded:
            break
        decoded = next_decoded
    return decoded


def _parse_ip_literal(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    normalized = host.strip("[]")
    try:
        return ipaddress.ip_address(normalized)
    except ValueError:
        pass

    if re.fullmatch(r"(0x[0-9a-f]+|\d+)", normalized, re.IGNORECASE):
        try:
            value = int(normalized, 16) if normalized.lower().startswith("0x") else int(normalized, 10)
            return ipaddress.IPv4Address(value)
        except ValueError:
            return None

    if re.fullmatch(r"[0-9a-fxA-F.]+", normalized):
        try:
            packed = socket.inet_aton(normalized)
            return ipaddress.IPv4Address(packed)
        except OSError:
            return None

    return None


def _resolve_hostname(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        records = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError:
        return []

    resolved: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for record in records:
        sockaddr = record[4]
        if not sockaddr:
            continue
        try:
            resolved.append(ipaddress.ip_address(sockaddr[0]))
        except ValueError:
            continue
    return resolved


def _is_unsafe_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_unspecified
        or ip.is_multicast
    )

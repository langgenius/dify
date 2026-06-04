from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

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
    INTERNAL_TARGET_RE = re.compile(
        r"(169\.254\.169\.254|127\.0\.0\.1|localhost|0\.0\.0\.0|::1|file://|/etc/passwd|/proc/self)",
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
        has_human_review = any(_is_human_review_node(node) for node in nodes)

        for node in nodes:
            node_id = str(node.get("id") or node.get("node_id") or "unknown")
            data = node.get("data") if isinstance(node.get("data"), dict) else {}
            node_type = _node_type(node)
            serialized = json.dumps(node, ensure_ascii=False, default=str)

            findings.extend(cls._review_prompt_text(node_id=node_id, node_type=node_type, serialized=serialized))
            findings.extend(cls._review_internal_targets(node_id=node_id, node_type=node_type, serialized=serialized))

            if node_type in {"http-request", "http"}:
                findings.extend(
                    cls._review_http_node(
                        node_id=node_id,
                        node_type=node_type,
                        data=data,
                        serialized=serialized,
                    )
                )
            elif node_type == "code":
                findings.append(
                    SafetyFinding(
                        rule_id="code.execution.requires_review",
                        severity=SafetySeverity.HIGH if not has_human_review else SafetySeverity.MEDIUM,
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
            elif "agent" in node_type:
                findings.extend(
                    cls._review_agent_node(
                        node_id=node_id,
                        node_type=node_type,
                        data=data,
                        serialized=serialized,
                        has_human_review=has_human_review,
                    )
                )

        findings.extend(
            cls._review_variables(
                workflow=workflow,
                node_types=node_types,
                has_human_review=has_human_review,
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
    def _review_prompt_text(cls, *, node_id: str, node_type: str, serialized: str) -> list[SafetyFinding]:
        if not cls.PROMPT_INJECTION_RE.search(serialized):
            return []
        return [
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
        ]

    @classmethod
    def _review_internal_targets(cls, *, node_id: str, node_type: str, serialized: str) -> list[SafetyFinding]:
        if not cls.INTERNAL_TARGET_RE.search(serialized):
            return []
        return [
            SafetyFinding(
                rule_id="network.internal_target",
                severity=SafetySeverity.CRITICAL,
                title="Internal or local network target",
                message="The workflow references an internal, local, file, or metadata-service target.",
                node_id=node_id,
                node_type=node_type,
                remediation=(
                    "Remove internal targets or route access through an approved "
                    "connector with SSRF protection."
                ),
            )
        ]

    @classmethod
    def _review_http_node(
        cls, *, node_id: str, node_type: str, data: dict[str, Any], serialized: str
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
        url_like = json.dumps(data.get("url") or data.get("url_template") or data, ensure_ascii=False, default=str)
        if "{{" in url_like or "#sys." in url_like or "#conversation." in url_like or "#context." in url_like:
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
        if cls.SECRET_NAME_RE.search(serialized):
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
        cls, *, node_id: str, node_type: str, data: dict[str, Any], serialized: str, has_human_review: bool
    ) -> list[SafetyFinding]:
        findings: list[SafetyFinding] = []
        if "tool" in serialized.lower():
            findings.append(
                SafetyFinding(
                    rule_id="agent.tools.require_review",
                    severity=SafetySeverity.HIGH if not has_human_review else SafetySeverity.MEDIUM,
                    title="Agent tool use needs release review",
                    message="The agent can call tools after publish, but no human review step was detected.",
                    node_id=node_id,
                    node_type=node_type,
                    remediation="Add a human review/approval node for tool-using agent flows before external action.",
                )
            )
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


def _is_human_review_node(node: dict[str, Any]) -> bool:
    node_type = _node_type(node)
    if node_type in {"human-input", "human_input", "approval", "review"}:
        return True
    serialized = json.dumps(node, ensure_ascii=False, default=str).lower()
    return "human" in serialized and ("approval" in serialized or "review" in serialized)

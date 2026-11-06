"""Finite sanitized execution-refusal copy; no graph/input/error interpolation."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import TYPE_CHECKING, Any

from runtime_contracts.builder.copy_ids import BuilderCopyId
from runtime_contracts.builder.execution import ExecutionEvidenceSummary
from runtime_contracts.builder.presentation import BuilderText, copy_text, text_parts
from services.dify_builder.native_launch_observation import FailureResource

if TYPE_CHECKING:
    from core.dify_builder.models import Run

FALLBACK = copy_text(BuilderCopyId.REPLIES_EXECUTION_SAFETY_REQUIRES_REVIEW_OR_REVISED)
_MESSAGES = {
    "execution_permission_denied": copy_text(BuilderCopyId.TEST_PERMISSION_DENIED),
    "execution_owner_mismatch": copy_text(BuilderCopyId.TEST_PERMISSION_DENIED),
    "agent_access_denied": copy_text(BuilderCopyId.TEST_PERMISSION_DENIED),
    "stale_execution_revision": copy_text(BuilderCopyId.TEST_CONTEXT_CHANGED),
    "test_input_binding_mismatch": copy_text(BuilderCopyId.TEST_CONTEXT_CHANGED),
    "effective_input_binding_mismatch": copy_text(BuilderCopyId.TEST_CONTEXT_CHANGED),
    "context_digest_mismatch": copy_text(BuilderCopyId.TEST_CONTEXT_CHANGED),
    "agent_capability_changed": copy_text(BuilderCopyId.TEST_CONTEXT_CHANGED),
    "code_risk_assessment_stale": copy_text(BuilderCopyId.TEST_POLICY_REVIEW),
    "installed_tool_unavailable": copy_text(BuilderCopyId.RESOURCES_CATALOGUE_UNAVAILABLE),
    "agent_tool_metadata_unavailable": copy_text(BuilderCopyId.RESOURCES_CATALOGUE_UNAVAILABLE),
    "agent_not_available": copy_text(BuilderCopyId.RESOURCES_CATALOGUE_UNAVAILABLE),
    "unsupported_node_implementation": copy_text(BuilderCopyId.REPLIES_BUILDER_DOES_NOT_YET_HAVE_SAFE),
    "unsupported_json_tool_configuration": copy_text(BuilderCopyId.REPLIES_BUILDER_CANNOT_SAFELY_TEST_THIS_TOOL),
    "unsupported_json_credentials": copy_text(BuilderCopyId.REPLIES_BUILDER_CANNOT_SAFELY_TEST_THIS_TOOL2),
    "unsupported_json_content_constant": copy_text(BuilderCopyId.REPLIES_PUT_THIS_J_S_O_N_CONTENT_IN_A),
    "unsupported_json_filter": copy_text(BuilderCopyId.REPLIES_USE_A_SUPPORTED_J_S_O_N_PATH_SELECTION),
    "unsupported_json_selector": copy_text(BuilderCopyId.REPLIES_BIND_J_S_O_N_PARSE_TEXT_FROM_A),
    "invalid_json_parameters": copy_text(BuilderCopyId.REPLIES_SET_J_S_O_N_PARSE_CONTENT_AND_FILTER),
    "json_execution_limit": copy_text(BuilderCopyId.REPLIES_REDUCE_J_S_O_N_PARSE_INPUT_OR_OUTPUT),
    "installed_json_tool_unavailable": copy_text(BuilderCopyId.REPLIES_INSTALL_THE_QUALIFIED_J_S_O_N_PROCESS_VERSION),
    "unsupported_json_tool_installation": copy_text(
        BuilderCopyId.REPLIES_INSTALL_THE_QUALIFIED_J_S_O_N_PROCESS_VERSION
    ),
    "json_tool_installation_changed": copy_text(BuilderCopyId.REPLIES_THE_INSTALLED_J_S_O_N_PROCESS_VERSION_CHANGED),
    "unsupported_template_syntax": copy_text(BuilderCopyId.REPLIES_TEMPLATE_SUPPORTS_SCALAR_TEXT_IF_ELIF),
    "unsupported_template_configuration": copy_text(BuilderCopyId.REPLIES_EDIT_TEMPLATE_VARIABLES_TO_USE_UNIQUE),
    "unsupported_template_selector": copy_text(BuilderCopyId.REPLIES_USE_TEMPLATE_INPUTS_FROM_START_SCALARS),
    "template_execution_limit": copy_text(BuilderCopyId.REPLIES_REDUCE_TEMPLATE_SIZE_OR_SELECTED_TEXT),
}


def execution_refusal_message(reason_code: str) -> BuilderText:
    return _MESSAGES.get(reason_code, FALLBACK)


# One Code-only preparation fallback. Existing fixed-copy IDs are translated by
# Web; this backend-only disclosure cannot add a frontend catalog dependency.
_CODE_RISK_UNAVAILABLE = {
    "en": "The Code risk explanation is unavailable. This test will simulate this step "
    "and cannot verify its real behavior. "
    "Prepare a new test to try the risk review again.",
    "zh": "暂时无法说明此代码步骤的风险。本次测试将模拟该节点，无法验证其业务行为。请重新准备测试以重试风险评估。",
}


def code_risk_unavailable_notice(reply_language: str) -> str:
    return _CODE_RISK_UNAVAILABLE["zh" if reply_language.lower().startswith("zh") else "en"]


# Only bounded backend-owned display labels are translated here. Technical
# codes remain in diagnostics/failure_code; resource names and user text are
# never interpreted as localization keys. Other locales use the English label.
_REASON_LABELS = {
    "connection_refused": ("connection refused", "连接被拒绝"),
    "timeout": ("request timed out", "请求超时"),
    "authentication": ("authentication failed", "身份认证失败"),
    "permission_denied": ("provider permission denied", "提供商权限被拒绝"),
    "credential_unavailable": ("credential missing or inaccessible", "凭据缺失或无权访问"),
    "authorization_lookup_failed": ("credential access could not be verified", "无法验证凭据访问权限"),
    "rate_limit": ("rate limit exceeded", "请求超过频率限制"),
    "service_unavailable": ("service unavailable", "服务不可用"),
    "provider_invocation_failed": ("model invocation failed", "模型调用失败"),
    "model_resolution_failed": ("model configuration unavailable", "模型配置不可用"),
    "empty_response": ("empty model response", "模型响应为空"),
    "json_decode_failed": ("invalid JSON response", "模型响应不是有效的 JSON"),
    "response_schema_invalid": ("response does not match the required schema", "模型响应不符合要求的结构"),
    "unknown": ("cause unavailable", "暂未获取到具体原因"),
}
_SCOPE_LABELS = {"structure": ("structure", "结构"), "configuration": ("configuration", "配置")}


def _display_label(labels: Mapping[str, tuple[str, str]], value: str, reply_language: str) -> str:
    pair = labels.get(value)
    return pair[1 if reply_language.lower().startswith("zh") else 0] if pair else value


def change_scope_label(scope: str, reply_language: str) -> str:
    """Translate the display scope without mutating the ChangeSet's machine scope."""
    return _display_label(_SCOPE_LABELS, scope, reply_language)


def observed_failure_message(
    summary: ExecutionEvidenceSummary | None, *, reply_language: str = "en-US"
) -> BuilderText | None:
    """Observed preparation failure and unknown effects need different recovery."""
    if summary is None:
        return None
    if (
        summary.failure_resource
        and summary.failure_reason
        in {"authentication", "permission_denied", "credential_unavailable", "authorization_lookup_failed"}
        and summary.sealed
        and (
            summary.safety_outcome == "preparation_failed"
            or (summary.safety_outcome == "native_failed" and summary.failure_phase == "execution")
        )
    ):
        return _resource_setup_guidance(
            reason=summary.failure_reason,
            resource=summary.failure_resource,
            node_ids=summary.failure_node_ids,
            reply_language=reply_language,
        )
    if summary.safety_outcome == "preparation_failed" or (
        summary.safety_outcome == "native_failed" and summary.failure_phase == "execution"
    ):
        message = (
            copy_text(BuilderCopyId.TEST_RUNTIME_SERVICE_FAILED)
            if summary.failure_phase == "execution"
            else copy_text(
                BuilderCopyId.TEST_PREPARATION_FAILED,
                reason=_display_label(_REASON_LABELS, summary.failure_reason or "unknown", reply_language),
            )
        )
        if summary.failure_resource:
            _, provider, name = summary.failure_resource
            return text_parts(
                message, "\n", "/".join(filter(None, (provider, name))), "\n", ", ".join(summary.failure_node_ids)
            )
        return message
    if summary.safety_outcome == "execution_evidence_unknown":
        return copy_text(BuilderCopyId.REPLIES_EXECUTION_OUTCOME_IS_UNKNOWN_RUN_AGAIN_BEFORE_PUBLISHING)
    return None


def native_service_failure(run: Run) -> bool:
    """Observed resource failure: preserve the Run, avoid speculative graph repair."""
    summary = run.verification.execution_evidence if run.verification else None
    if (
        run.status == "failed"
        and not run.dify_run_id
        and summary is not None
        and summary.sealed
        and summary.safety_outcome == "preparation_failed"
        and summary.failure_phase == "preparation"
        and summary.failure_resource is not None
        and bool(summary.failure_node_ids)
        and summary.failure_reason in {"credential_unavailable", "authorization_lookup_failed"}
    ):
        return True
    return bool(
        run.status == "failed"
        and run.dify_run_id
        and summary is not None
        and summary.sealed
        and summary.native_run_id == run.dify_run_id
        and summary.failure_resource is not None
        and bool(summary.failure_node_ids)
        and summary.safety_outcome == "native_failed"
        and summary.failure_phase == "execution"
        and summary.failure_reason in {"service_unavailable", "authentication", "permission_denied"}
    )


def _resource_setup_guidance(
    *, reason: str, resource: FailureResource, node_ids: tuple[str, ...], reply_language: str
) -> str:
    label = _display_label(_REASON_LABELS, reason, reply_language)
    resource_label = "/".join(filter(None, resource[1:]))
    nodes = ", ".join(node_ids)
    if reply_language.lower().startswith("zh"):
        recovery = (
            "请检查工作区凭据访问权限后重新准备测试。"
            if reason == "authorization_lookup_failed"
            else "请配置或选择有权访问此资源的凭据，并检查提供商权限后重新准备测试。"
        )
        return f"资源设置失败：{label}。{recovery}\n{resource_label}\n{nodes}"
    recovery = (
        "Check workspace credential access before preparing a fresh test."
        if reason == "authorization_lookup_failed"
        else "Configure or select an authorized credential and check provider permissions "
        "before preparing a fresh test."
    )
    return f"Resource setup failed: {label}. {recovery}\n{resource_label}\n{nodes}"


def sanitize_observed_failure(run: Run) -> Run:
    """Bound Builder errors only; native authorized Run storage keeps original evidence."""
    summary = run.verification.execution_evidence if run.verification else None
    if (
        not native_service_failure(run)
        or summary is None
        or summary.failure_resource is None
        or summary.failure_reason is None
        or summary.failure_reason == "service_unavailable"
    ):
        return run
    guidance = _resource_setup_guidance(
        reason=summary.failure_reason,
        resource=summary.failure_resource,
        node_ids=summary.failure_node_ids,
        reply_language="en",
    )
    return replace(
        run,
        error=guidance,
        per_node=[
            replace(node, error=guidance) if node.node_id in summary.failure_node_ids and node.error else node
            for node in run.per_node
        ],
    )


def sanitize_resource_failure_event(
    payload: Mapping[str, Any], *, graph: Mapping[str, Any], recognized_errors: dict[str, str]
) -> Mapping[str, Any]:
    """Suppress recognized provider bodies in Builder streams, never seal evidence.

    The admitted graph and native stream ID scope presentation only. Terminal
    classification still requires the persisted executed graph and native rows.
    Code/unattributed errors retain their existing diagnostics.
    """
    from core.dify_builder.models import NodeOutput, Run
    from services.dify_builder.native_runtime_failure import native_resource_failure
    from services.dify_builder.run_mapping import run_id_from_stream_chunk

    data = payload.get("data")
    native_id = run_id_from_stream_chunk(payload)
    if not native_id or not isinstance(data, Mapping) or data.get("status") not in {"failed", "exception"}:
        return payload
    error = data.get("error")
    if not isinstance(error, str) or not error:
        return payload
    key = f"{native_id}:{error}"
    guidance = None
    if payload.get("event") == "node_finished" and isinstance(node_id := data.get("node_id"), str):
        failure = native_resource_failure(
            Run(
                status="failed",
                dify_run_id=native_id,
                per_node=[NodeOutput(node_id=node_id, status="failed", error=error)],
            ),
            graph,
        )
        if failure is not None and failure[2] in {"authentication", "permission_denied"}:
            guidance = _resource_setup_guidance(
                reason=failure[2], resource=failure[0], node_ids=failure[1], reply_language="en"
            )
            recognized_errors[key] = guidance
    elif payload.get("event") == "workflow_finished":
        guidance = recognized_errors.get(key)
    return {**payload, "data": {**data, "error": guidance}} if guidance else payload


def cognition_failure_message(
    records: Sequence[Mapping[str, Any]], fallback: BuilderText, *, reply_language: str = "en-US"
) -> BuilderText:
    """Use bounded observations from this operation; never provider error text."""
    for record in reversed(records):
        code = record.get("code")
        if isinstance(code, str) and code in {
            "provider_invocation_failed",
            "model_resolution_failed",
            "empty_response",
            "json_decode_failed",
            "response_schema_invalid",
        }:
            reason = record.get("reason")
            if not isinstance(reason, str) or reason not in {
                "connection_refused",
                "timeout",
                "authentication",
                "rate_limit",
                "service_unavailable",
            }:
                reason = code
            return copy_text(
                BuilderCopyId.OPERATION_MODEL_FAILED, reason=_display_label(_REASON_LABELS, reason, reply_language)
            )
    return fallback

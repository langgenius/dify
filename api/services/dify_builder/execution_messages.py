"""Finite sanitized execution-refusal copy; no graph/input/error interpolation."""

from services.dify_builder.copy_ids import BuilderCopyId
from services.dify_builder.presentation import BuilderText, copy_text

FALLBACK = copy_text(BuilderCopyId.REPLIES_EXECUTION_SAFETY_REQUIRES_REVIEW_OR_REVISED)
_MESSAGES = {
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

"""Explicit source exclusions must not invent a retrieval clarification goal."""

import pytest

from services.dify_builder.plan import has_knowledge_source_cue

MEETING_GOAL = (
    "合成补充验收，不是原始 ENG1235 输入回放。创建会后纪要 Workflow：Start 只接收必填文本 meeting_notes；"
    "用当前已有模型整理中文纪要，End 输出文本 minutes，明确分为结论、待办、待确认事项。"
    "严格区分已决定与未决定；未提供的负责人、日期、金额只能注明待确认，不能补造。"
    "不发送通知，不使用工具、HTTP、Agent、知识库、文件或外部业务账户。先给计划，等待批准；不测试、不发布。"
)


CAPTURED_MEETING_GOAL = (
    "创建一个专用的合成会议纪要验收 Workflow 草稿，名称"
    "「Dev ENG1235 Meeting 439e」。先生成"
    "计划供我审阅，不要执行测试或发布。只允许 Start → 一"
    "个当前已经配置可用模型的 LLM → End，3 个节点、2"
    " 条连线，不需要任何新资源、工具、Code、Agent、HT"
    "TP、知识库、文件或凭据。Start 必填文本输入 meet"
    "ing_notes。LLM 根据会议原文，用中文按顺序输出四"
    "节：结论、待办、待确认事项、风险与阻塞。区分已决定与未决定；"
    "对缺失负责人、日期、金额标注待确认，不编造；风险与阻塞只列原"
    "文明示内容，未提及则写「原文未提及」。End 返回文本 mi"
    "nutes，绑定 LLM 的 text。"
)
CAPTURED_MEETING_REQUIREMENTS = {
    "mode": "workflow_draft_plan_only",
    "publish": False,
    "llm_model": "当前已经配置可用的模型",
    "llm_rules": [
        "区分已决定与未决定",
        "对缺失负责人、日期、金额标注待确认，不编造",
        "风险与阻塞只列原文明示内容，未提及则写「原文未提及」",
    ],
    "edge_count": 2,
    "node_count": 3,
    "end_outputs": [{"type": "text", "variable": "minutes", "value_selector": "LLM.text"}],
    "start_inputs": [{"type": "text", "required": True, "variable": "meeting_notes"}],
    "allowed_nodes": ["Start", "LLM", "End"],
    "execute_tests": False,
    "workflow_name": "Dev ENG1235 Meeting 439e",
    "excluded_resources": ["工具", "Code", "Agent", "HTTP", "知识库", "文件", "凭据"],
    "llm_output_language": "中文",
    "new_resources_allowed": False,
    "llm_output_sections_in_order": ["结论", "待办", "待确认事项", "风险与阻塞"],
}


CAPTURED_AGENT_GOAL = (
    "请生成一个合同风险初筛 Workflow。Start 节点接收 contract_text"
    "（合同正文，文本，必填）和 jurisdiction（适用地区，文本，选填）。优先搜索当前"
    " Workspace 中已发布、我和这个 Workflow 都有权调用的现有 Agent，"
    "让它识别高风险条款。End 节点输出 risks 和 summary。请展示你选用该 Ag"
    "ent 的理由、版本与权限状态；不要创建新 Agent，也不要使用旧版 Agent 节点。"
    "\n\n本次是同一专用未发布 App 的新 BUILD 计划，不续跑任何旧 Run。资源选择已"
    "明确：仅使用当前 Workspace 中已有、已发布、且本账号与本 Workflow 有权"
    "调用的“ENG1376 Contract Risk Reviewer a1 2026103"
    "0”，Agent ID 01a18ce5-e037-77b9-bf99-c20a39d49"
    "024，当前 published display version 4、immutable "
    "snapshot 01a19641-cdb3-7981-b257-5a12dce30849"
    "（max_tokens=8192）。必须核对真实可用性、版本和权限；若该精确资源不可用，请"
    "停住说明，不能替换、创建或升级其他 Agent。工作流严格限定为 Start（contra"
    "ct_text 文本必填、jurisdiction 文本选填）→这个已发布 Agent→E"
    "nd（risks、summary，沿用当前草稿已声明的输出约定）。不要增加其他 Agent"
    "、工具、HTTP、Code、文件或知识库。先展示正式计划并等待明确批准；本阶段不得生成或改"
    "写画布、运行 Agent/Workflow、测试或发布。"
)
CAPTURED_FORBIDDEN_ADDITIONS = {"forbidden_additions": ["其他 Agent", "工具", "HTTP", "Code", "文件", "知识库"]}
CAPTURED_NO_EXTRA_COMPONENTS = {"no_extra_components": ["其他 Agent", "工具", "HTTP", "Code", "文件", "知识库"]}
CAPTURED_BARE_ROLE_REQUIREMENTS = {
    "agent": {
        "name": "ENG1376 Contract Risk Reviewer a1 20261030",
        "task": "识别高风险条款",
        "agent_id": "01a18ce5-e037-77b9-bf99-c20a39d49024",
        "max_tokens": "<redacted>",
        "constraints": [
            "仅使用现有已发布 Agent",
            "不创建新 Agent",
            "不使用旧版 Agent 节点",
            "必须核对真实可用性、版本和权限",
            "若精确资源不可用则停住说明，不替换/创建/升级",
        ],
        "immutable_snapshot": "01a19641-cdb3-7981-b257-5a12dce30849",
        "published_display_version": 4,
    },
    "disallowed": ["其他 Agent", "工具", "HTTP", "Code", "文件", "知识库"],
    "end_outputs": ["risks", "summary"],
    "start_inputs": [
        {"name": "contract_text", "type": "text", "label": "合同正文", "required": True},
        {"name": "jurisdiction", "type": "text", "label": "适用地区", "required": False},
    ],
    "workflow_structure": "Start → 已发布 Agent → End",
    "no_run_or_publish_this_phase": True,
    "require_plan_approval_before_build": True,
}


@pytest.mark.parametrize(
    "requirements",
    [
        {"knowledge_base": False},
        {"knowledge_base": None},
        {"knowledge_base": {"enabled": False}},
        {"knowledge_base": {"enabled": True}},
        {"knowledge_base": "false"},
        {"rules": [False, {"knowledge_base": False}, "不使用知识库"]},
    ],
)
def test_requirement_keys_and_nontext_values_do_not_invent_source_use(requirements: object) -> None:
    assert not has_knowledge_source_cue("Format the supplied text", requirements)


@pytest.mark.parametrize(
    "requirements",
    [
        {"source": "必须使用知识库回答"},
        {"rules": [False, {"source": "Retrieve from the knowledge base"}]},
        {"rules": [{"source": "不使用工具，必须查询文档和知识库"}]},
        {"rules": [{"source": "Do not use tools, retrieve answers from documents and knowledge bases."}]},
        ["Use knowledge_base", {"knowledge_base": False}],
    ],
)
def test_affirmative_requirement_overrides_goal_exclusion(requirements: object) -> None:
    assert has_knowledge_source_cue("不要使用知识库", requirements)


@pytest.mark.parametrize(
    ("goal", "requirements"),
    [
        (CAPTURED_AGENT_GOAL, {}),
        ("", CAPTURED_FORBIDDEN_ADDITIONS),
        (CAPTURED_AGENT_GOAL, CAPTURED_FORBIDDEN_ADDITIONS),
    ],
    ids=["goal", "requirements", "both"],
)
def test_captured_agent_only_goal_and_forbidden_resource_list_do_not_invent_knowledge_use(
    goal: str, requirements: dict[str, object]
) -> None:
    assert not has_knowledge_source_cue(goal, requirements)


@pytest.mark.parametrize("requirements", [{}, None])
def test_captured_meeting_goal_excludes_knowledge_without_a_goal_change(requirements: object) -> None:
    assert not has_knowledge_source_cue(
        CAPTURED_MEETING_GOAL, CAPTURED_MEETING_REQUIREMENTS if requirements is None else requirements
    )


@pytest.mark.parametrize(
    ("goal", "requires_clarification"),
    [
        ("不要使用知识库，只整理输入的文本。", False),
        ("Do not use tools, HTTP, agents, knowledge bases or files.", False),
        ("必须使用知识库回答。", True),
        ("Do not use knowledge base A; use knowledge base B for answers.", True),
        ("Do not use a knowledge base unless the question needs it.", True),
    ],
)
def test_goal_distinguishes_excluded_required_and_conditional_sources(goal: str, requires_clarification: bool) -> None:
    assert has_knowledge_source_cue(goal, {}) is requires_clarification

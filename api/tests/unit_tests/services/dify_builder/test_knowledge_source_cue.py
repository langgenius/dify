"""Explicit source exclusions must not invent a retrieval clarification goal."""

import pytest

from services.dify_builder.plan import has_knowledge_source_cue

MEETING_GOAL = (
    "合成补充验收，不是原始 ENG1235 输入回放。创建会后纪要 Workflow：Start 只接收必填文本 meeting_notes；"
    "用当前已有模型整理中文纪要，End 输出文本 minutes，明确分为结论、待办、待确认事项。"
    "严格区分已决定与未决定；未提供的负责人、日期、金额只能注明待确认，不能补造。"
    "不发送通知，不使用工具、HTTP、Agent、知识库、文件或外部业务账户。先给计划，等待批准；不测试、不发布。"
)


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


@pytest.mark.parametrize(
    "goal",
    [
        MEETING_GOAL,
        "不使用知识库，只整理用户提供的文本。",
        "无需知识库。",
        "禁止访问外部知识库。",
        "不要依赖知识库。",
        "不使用工具和知识库。",
        "Do not use a knowledge base.",
        "Do not use tools, HTTP, agents, knowledge bases or files.",
        "Never query the knowledge base.",
        "Format the input without knowledge_base.",
        "No need to use a knowledge base.",
    ],
)
def test_explicitly_excluded_source_does_not_create_a_knowledge_goal(goal: str) -> None:
    assert not has_knowledge_source_cue(goal, {})


@pytest.mark.parametrize(
    "goal",
    [
        "必须使用知识库回答。",
        "先不要使用知识库，但后续必须使用知识库回答。",
        "不使用HTTP，改用知识库回答。",
        "不使用工具，必须查询文档和知识库",
        "Do not use tools, retrieve answers from documents and knowledge bases.",
        "不使用知识库A，需要知识库B回答。",
        "Do not use knowledge base A; use knowledge base B for answers.",
        "不要生成知识库节点，但仍需检索。",
        "不使用知识库节点，但仍需检索公司的文档。",
        "不能不检索知识库。",
        "不可以不使用知识库",
        "不需要禁止使用知识库。",
        "不要不使用知识库。",
        "禁止不使用知识库。",
        "不使用知识库，但必须从 knowledge_base 检索。",
        "Do not use a knowledge base; retrieve answers from the knowledge base.",
        "Do not generate knowledge retrieval nodes, but still retrieve from a knowledge base.",
        "Do not use knowledge base nodes, but keep retrieval.",
        "Do not avoid using the knowledge base.",
        "You cannot avoid using the knowledge base.",
        "You can't avoid using the knowledge base.",
        "You shouldn't avoid using the knowledge base.",
        "Not without a knowledge base.",
        "Do not use a knowledge base unless the question needs retrieval.",
        "除非必要，否则不使用知识库。",
        "Knowledge base access is undecided.",
        "Without changing the knowledge base, retrieve answers from it.",
        "不使用财务系统和知识库。",
        "Do not use the bespoke registry and knowledge bases.",
    ],
)
def test_affirmative_mixed_or_uncertain_source_still_requires_clarification(goal: str) -> None:
    assert has_knowledge_source_cue(goal, {})


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


@pytest.mark.parametrize(
    "goal",
    [
        "不要增加知识库。",
        "不要添加其他 Agent、工具、HTTP、Code、文件或知识库。",
        "不增加代码、知识库。",
        "禁止添加 Code 和知识库。",
        "Do not add other agents, tools, HTTP, Code, files or knowledge bases.",
    ],
)
def test_direct_add_exclusion_only_discounts_known_resource_categories(goal: str) -> None:
    assert not has_knowledge_source_cue(goal, {})


@pytest.mark.parametrize("key", ["forbidden_additions", "forbidden_resources", "excluded_resources"])
def test_explicit_resource_exclusion_list_keeps_its_role_when_nested(key: str) -> None:
    assert not has_knowledge_source_cue("Format supplied text", {"scope": {key: ["知识库", "knowledge base"]}})


@pytest.mark.parametrize(
    ("goal", "requirements"),
    [
        ("不要增加知识库节点，但仍需检索。", {}),
        ("不能不添加知识库。", {}),
        ("如果需要就不要添加知识库。", {}),
        ("不要增加知识库，但仍需使用知识库回答。", {}),
        ("不要添加财务系统和知识库。", {}),
        ("不要增加知识库", {"forbidden_additions": ["知识库"], "source": "必须使用知识库回答"}),
        ("", {"arbitrary": ["知识库"]}),
        ("", {"forbidden_nodes": ["知识库"]}),
        ("", {"forbidden_additions": ["知识库节点"]}),
        ("", {"forbidden_resources": {"source": "知识库"}}),
        ("", {"forbidden_additions": ["知识库", {"source": "知识库"}]}),
        ("", {"excluded_resources": ["知识库", "如果必要则查询知识库"]}),
        ("", {"forbidden_resources": ["知识库A"]}),
        ("", {"forbidden_additions": ("知识库",)}),
    ],
)
def test_exclusion_lists_never_hide_positive_unknown_or_node_only_requirements(
    goal: str, requirements: dict[str, object]
) -> None:
    assert has_knowledge_source_cue(goal, requirements)

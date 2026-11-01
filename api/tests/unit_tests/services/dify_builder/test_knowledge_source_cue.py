"""Explicit source exclusions must not invent a retrieval clarification goal."""

import pytest

from services.dify_builder.plan import has_knowledge_source_cue

MEETING_GOAL = (
    "合成补充验收，不是原始 ENG1235 输入回放。创建会后纪要 Workflow：Start 只接收必填文本 meeting_notes；"
    "用当前已有模型整理中文纪要，End 输出文本 minutes，明确分为结论、待办、待确认事项。"
    "严格区分已决定与未决定；未提供的负责人、日期、金额只能注明待确认，不能补造。"
    "不发送通知，不使用工具、HTTP、Agent、知识库、文件或外部业务账户。先给计划，等待批准；不测试、不发布。"
)


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

"""Unit tests for the prompt mention contract (ENG-616).

Token form: ``[§<kind>:<id>[:<label>]§]``. Mentions are pointers into the Agent
config lists; expansion replaces them with canonical names and the scrub pass
guarantees no mention-shaped marker survives to the model.
"""

from __future__ import annotations

from urllib.parse import quote

import pytest

from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig, WorkflowPreviousNodeOutputRef
from services.agent.prompt_mentions import (
    MAX_MENTION_REF_ID_LENGTH,
    NODE_JOB_PROMPT_ALLOWED_KINDS,
    SOUL_PROMPT_ALLOWED_KINDS,
    MentionKind,
    build_node_job_mention_resolver,
    build_soul_mention_resolver,
    expand_prompt_mentions,
    extract_workflow_node_output_selectors,
    extract_workflow_variable_selectors,
    normalize_previous_node_output_selector,
    parse_prompt_mentions,
    scrub_mention_markers,
    workflow_previous_node_output_refs_from_selectors,
)

# ── parse ─────────────────────────────────────────────────────────────────────


def test_parse_extracts_kind_id_and_optional_label():
    prompt = "Use [§skill:tender-analyzer%2FSKILL.md:tender-analyzer§] then ask [§human:c-1§]."
    mentions = parse_prompt_mentions(prompt)

    assert [(m.kind, m.ref_id, m.label) for m in mentions] == [
        (MentionKind.SKILL, "tender-analyzer%2FSKILL.md", "tender-analyzer"),
        (MentionKind.HUMAN, "c-1", None),
    ]
    assert prompt[mentions[0].start : mentions[0].end] == mentions[0].raw


def test_parse_supports_ids_with_slash_and_dot():
    mentions = parse_prompt_mentions("[§tool:langgenius/tavily/tavily_search:tavily§] [§node_output:node-1.tenders§]")
    assert mentions[0].ref_id == "langgenius/tavily/tavily_search"
    assert mentions[1].ref_id == "node-1.tenders"


def test_parse_supports_legacy_bare_output_tokens():
    mentions = parse_prompt_mentions("Use §output:summary:summary§")
    assert [(mention.kind, mention.ref_id, mention.label) for mention in mentions] == [
        (MentionKind.OUTPUT, "summary", "summary")
    ]


def test_parse_ignores_legacy_template_forms_and_unknown_kinds():
    prompt = "{{var}} {{#context#}} {{#sys.query#}} [§bogus_kind:x§]"
    assert parse_prompt_mentions(prompt) == []


def test_parse_skips_oversized_id_or_label():
    long_id = "x" * (MAX_MENTION_REF_ID_LENGTH + 1)
    assert parse_prompt_mentions(f"[§skill:{long_id}§]") == []


def test_parse_accepts_long_unicode_encoded_drive_key_within_drive_limit():
    encoded_drive_key = quote("你" * 512)
    mentions = parse_prompt_mentions(f"[§skill:{encoded_drive_key}:Long Skill§]")
    assert [(mention.kind, mention.ref_id) for mention in mentions] == [(MentionKind.SKILL, encoded_drive_key)]


# ── expand + scrub ────────────────────────────────────────────────────────────


def test_expand_uses_resolver_and_degrades_unresolved_to_label_then_id():
    prompt = "A [§skill:s1:Skill One§] B [§human:h1:EMAIL · DAVE§] C [§knowledge:k1§]"

    def resolver(mention):
        return "resolved-skill" if mention.kind == MentionKind.SKILL else None

    expanded = expand_prompt_mentions(prompt, resolver)
    assert expanded == "A resolved-skill B EMAIL · DAVE C k1"
    assert "[§" not in expanded


def test_expand_scrubs_unknown_kind_tokens_but_keeps_legacy_forms():
    prompt = "x [§wat:id-1:Label§] y {{#context#}} z {{#node.var#}}"
    expanded = expand_prompt_mentions(prompt, lambda m: None)
    # unknown mention-shaped token degraded to its label; legacy forms untouched
    assert expanded == "x Label y {{#context#}} z {{#node.var#}}"


def test_scrub_degrades_colon_tokens_without_label_to_id_part():
    assert scrub_mention_markers("see [§weird_kind:some-id§]") == "see some-id"


def test_expand_empty_prompt_is_noop():
    assert expand_prompt_mentions("", lambda m: "x") == ""


def test_extract_workflow_variable_selectors_supports_frontend_agent_task_format():
    selectors = extract_workflow_variable_selectors(
        "Read {{#node-1.output#}}, compare {{#start.question#}}, leave {{#context#}} alone."
    )
    assert selectors == [("node-1", "output"), ("start", "question")]


def test_extract_workflow_node_output_selectors_supports_current_frontend_markers_only():
    selectors = extract_workflow_node_output_selectors(
        "Read {{#node-1.output#}}, {{#sys.query#}}, [§node_output:legacy-node.report:PREV/report§], "
        "and {{#node-1.output#}} again."
    )
    assert selectors == [("node-1", "output")]


def test_workflow_previous_node_output_refs_from_selectors_materializes_refs():
    refs = workflow_previous_node_output_refs_from_selectors([("node-1", "output"), ("node-2", "report", "url")])

    assert refs == [
        WorkflowPreviousNodeOutputRef(selector=["node-1", "output"], node_id="node-1", output="output"),
        WorkflowPreviousNodeOutputRef(
            selector=["node-2", "report", "url"],
            node_id="node-2",
            output="report",
        ),
    ]


# ── soul resolver ─────────────────────────────────────────────────────────────


@pytest.fixture
def soul() -> AgentSoulConfig:
    return AgentSoulConfig.model_validate(
        {
            "tools": {
                "dify_tools": [
                    {
                        "plugin_id": "langgenius/tavily",
                        "provider": "tavily",
                        "tool_name": "tavily_search",
                        "credential_type": "unauthorized",
                    },
                ],
                "cli_tools": [{"id": "ct-1", "name": "ffmpeg"}],
            },
            "knowledge": {
                "sets": [
                    {
                        "id": "kb-1",
                        "name": "产品手册",
                        "datasets": [{"id": "ds-1", "name": "产品手册"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                    }
                ]
            },
            "human": {"contacts": [{"id": "c-1", "name": "David Hayes", "channel": "email"}]},
        }
    )


def test_soul_resolver_resolves_each_kind(soul: AgentSoulConfig):
    resolver = build_soul_mention_resolver(soul)
    prompt = (
        "Use [§tool:tavily/tavily_search:tavily§], run [§cli_tool:ct-1:ffmpeg§], "
        "ground in [§knowledge:kb-1§], ask [§human:c-1§]."
    )

    expanded = expand_prompt_mentions(prompt, resolver)

    assert expanded == ("Use tavily_search, run ffmpeg, ground in 产品手册, ask EMAIL · David Hayes.")


def test_soul_resolver_unknown_ids_degrade(soul: AgentSoulConfig):
    expanded = expand_prompt_mentions("[§knowledge:missing:旧产品手册§]", build_soul_mention_resolver(soul))
    assert expanded == "旧产品手册"


def test_soul_resolver_cli_tool_resolves_by_id_and_keeps_name_alias(soul: AgentSoulConfig):
    resolver = build_soul_mention_resolver(soul)
    # id is the contract; the name alias keeps tokens minted before ids existed working
    assert expand_prompt_mentions("[§cli_tool:ct-1§]", resolver) == "ffmpeg"
    assert expand_prompt_mentions("[§cli_tool:ffmpeg§]", resolver) == "ffmpeg"
    # a rename only changes the expansion, never breaks the id reference
    soul.tools.cli_tools[0].name = "ffmpeg-v7"
    assert expand_prompt_mentions("[§cli_tool:ct-1§]", build_soul_mention_resolver(soul)) == "ffmpeg-v7"


@pytest.fixture
def soul_with_provider_entry(soul: AgentSoulConfig) -> AgentSoulConfig:
    # provider-level entry (tool_name omitted) = all tools of the provider
    soul.tools.dify_tools.append(
        soul.tools.dify_tools[0].model_copy(
            update={"plugin_id": "langgenius/duckduckgo", "provider": "duckduckgo", "tool_name": None}
        )
    )
    return soul


def test_soul_resolver_provider_all_tools_mention(soul_with_provider_entry: AgentSoulConfig):
    resolver = build_soul_mention_resolver(soul_with_provider_entry)
    # [§tool:<provider>/*§] = all tools of that provider
    assert expand_prompt_mentions("Use [§tool:duckduckgo/*:DuckDuckGo 全部§].", resolver) == (
        "Use all duckduckgo tools."
    )
    # plugin-prefixed alias of the same provider
    assert expand_prompt_mentions("[§tool:langgenius/duckduckgo/duckduckgo/*§]", resolver) == "all duckduckgo tools"
    # without a provider-level entry the mention dangles -> degrades to label
    bare = build_soul_mention_resolver(AgentSoulConfig.model_validate({}))
    assert expand_prompt_mentions("[§tool:duckduckgo/*:DuckDuckGo 全部§]", bare) == "DuckDuckGo 全部"


def test_soul_resolver_single_tool_resolves_via_provider_level_entry(soul_with_provider_entry: AgentSoulConfig):
    # one tool offered through the provider-level ("all") entry still resolves
    resolver = build_soul_mention_resolver(soul_with_provider_entry)
    assert expand_prompt_mentions("[§tool:duckduckgo/ddg_search§]", resolver) == "ddg_search"


# ── node-job resolver ─────────────────────────────────────────────────────────


@pytest.fixture
def node_job() -> WorkflowNodeJobConfig:
    return WorkflowNodeJobConfig.model_validate(
        {
            "workflow_prompt": "",
            "previous_node_output_refs": [{"selector": ["start-1", "tenders"], "name": "START/tenders"}],
            # declared output names are JSON-schema-friendly identifiers (no dots)
            "declared_outputs": [{"name": "qna_report", "type": "file"}],
            "human_contacts": [{"id": "c-1", "name": "David Hayes", "channel": "email"}],
        }
    )


def test_node_job_resolver_resolves_each_kind(node_job: WorkflowNodeJobConfig):
    resolver = build_node_job_mention_resolver(node_job)
    prompt = "Read [§node_output:start-1.tenders§] and produce [§output:qna_report§]; if unsure contact [§human:c-1§]."

    expanded = expand_prompt_mentions(prompt, resolver)

    assert expanded == ("Read START/tenders and produce qna_report (file); if unsure contact EMAIL · David Hayes.")


def test_node_job_resolver_matches_ref_by_node_id_and_output_fields():
    node_job = WorkflowNodeJobConfig.model_validate(
        {"previous_node_output_refs": [{"node_id": "n-2", "output": "text"}]}
    )
    expanded = expand_prompt_mentions("[§node_output:n-2.text:LLM/text§]", build_node_job_mention_resolver(node_job))
    # ref has no display name -> degrade to the mention label
    assert expanded == "LLM/text"


def test_normalize_previous_node_output_selector_returns_canonical_selector():
    assert normalize_previous_node_output_selector(
        WorkflowPreviousNodeOutputRef(selector=["node-1", "report", "url"])
    ) == ("node-1", "report", "url")
    assert normalize_previous_node_output_selector(WorkflowPreviousNodeOutputRef(node_id="node-2", output="text")) == (
        "node-2",
        "text",
    )
    assert normalize_previous_node_output_selector(WorkflowPreviousNodeOutputRef(selector=["node-3", 1])) is None


# ── allowlists ────────────────────────────────────────────────────────────────


def test_per_surface_allowlists_match_design():
    assert {
        MentionKind.SKILL,
        MentionKind.FILE,
        MentionKind.TOOL,
        MentionKind.CLI_TOOL,
        MentionKind.KNOWLEDGE,
        MentionKind.HUMAN,
    } == SOUL_PROMPT_ALLOWED_KINDS
    assert {MentionKind.NODE_OUTPUT, MentionKind.OUTPUT, MentionKind.HUMAN} == NODE_JOB_PROMPT_ALLOWED_KINDS

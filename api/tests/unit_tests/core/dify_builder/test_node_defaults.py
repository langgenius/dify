"""Tests for the per-node-type default-config registry.

Values are pinned against the FE registry they mirror (``web/app/components
/workflow/nodes/<type>/default.ts``) -- see the per-entry comments in
``node_defaults.py`` for the exact source lines -- and each entry is validated
against the engine node data class that consumes it, so a graphon field that
gains or loses a default fails here rather than in a live Edit.
"""

import pytest

from core.dify_builder.node_defaults import default_config, default_config_or_empty


def test_default_config_start_matches_fe_default():
    assert default_config("start") == {"variables": []}


def test_default_config_end_matches_fe_default():
    assert default_config("end") == {"outputs": []}


def test_default_config_llm_matches_fe_default():
    assert default_config("llm") == {
        "model": {
            "provider": "",
            "name": "",
            "mode": "chat",
            "completion_params": {"temperature": 0.7},
        },
        "prompt_template": [{"role": "system", "text": ""}],
        "context": {"enabled": False, "variable_selector": []},
        "vision": {"enabled": False},
    }


def test_default_config_knowledge_retrieval_matches_fe_default():
    assert default_config("knowledge-retrieval") == {
        "query_variable_selector": [],
        "query_attachment_selector": [],
        "dataset_ids": [],
        "retrieval_mode": "multiple",
        "multiple_retrieval_config": {
            "top_k": 4,
            "score_threshold": None,
            "reranking_enable": False,
        },
    }


def test_default_config_answer_matches_fe_default():
    assert default_config("answer") == {"variables": [], "answer": ""}


def test_default_config_template_transform_matches_fe_default():
    assert default_config("template-transform") == {"template": "", "variables": []}


def test_default_config_code_matches_fe_default():
    assert default_config("code") == {
        "code": "",
        "code_language": "python3",
        "variables": [],
        "outputs": {},
    }


def test_default_config_variable_aggregator_matches_fe_default():
    """``nodes/variable-assigner/default.ts`` is the variable-AGGREGATOR's
    frontend directory; there is no ``nodes/variable-aggregator/``."""
    assert default_config("variable-aggregator") == {"output_type": "any", "variables": []}


def test_default_config_http_request_matches_fe_default():
    """``nodes/http/default.ts``; there is no ``nodes/http-request/``."""
    assert default_config("http-request") == {
        "variables": [],
        "method": "get",
        "url": "",
        "authorization": {"type": "no-auth", "config": None},
        "headers": "",
        "params": "",
        "body": {"type": "none", "data": []},
        "ssl_verify": True,
        "timeout": {"max_connect_timeout": 0, "max_read_timeout": 0, "max_write_timeout": 0},
        "retry_config": {"retry_enabled": True, "max_retries": 3, "retry_interval": 100},
    }


def test_default_config_if_else_matches_fe_default_without_target_branches():
    """``_targetBranches`` is editor-only state the canvas regenerates from
    ``cases``. A caller-supplied ``cases`` wins the merge while a default
    ``_targetBranches`` would not, so shipping one would attach a stale branch
    list to every Builder-created if-else."""
    default = default_config("if-else")

    assert default == {"cases": [{"case_id": "true", "logical_operator": "and", "conditions": []}]}
    assert "_targetBranches" not in default


def test_default_config_question_classifier_matches_fe_default_without_target_branches():
    default = default_config("question-classifier")

    assert default == {
        "query_variable_selector": [],
        "model": {
            "provider": "",
            "name": "",
            "mode": "chat",
            "completion_params": {"temperature": 0.7},
        },
        "classes": [
            {"id": "1", "name": "", "label": "CLASS 1"},
            {"id": "2", "name": "", "label": "CLASS 2"},
        ],
        "vision": {"enabled": False},
    }
    assert "_targetBranches" not in default


def test_default_config_tool_matches_fe_default():
    assert default_config("tool") == {
        "tool_parameters": {},
        "tool_configurations": {},
        "tool_node_version": "2",
    }


def test_default_config_raises_for_unregistered_node_type():
    with pytest.raises(ValueError, match="iteration"):
        default_config("iteration")


def test_default_config_returns_a_fresh_copy_each_call():
    first = default_config("start")
    first["variables"].append({"variable": "mutated"})

    second = default_config("start")

    assert second == {"variables": []}


# ---- default_config_or_empty ------------------------------------------------


def test_default_config_or_empty_returns_no_defaults_for_an_unregistered_type():
    """A node type this module does not cover must contribute no defaults --
    never abort the edit that is creating it."""
    assert default_config_or_empty("iteration") == {}


def test_default_config_or_empty_returns_the_same_values_as_default_config():
    assert default_config_or_empty("template-transform") == default_config("template-transform")


def test_default_config_or_empty_returns_a_fresh_copy_each_call():
    first = default_config_or_empty("code")
    first["outputs"]["mutated"] = {"type": "string"}

    assert default_config_or_empty("code")["outputs"] == {}


# ---- the engine accepts every default --------------------------------------
#
# The point of the registry is that a node built from it alone is a node the
# draft preflight will not refuse. Each case names the graphon data class that
# consumes the type and the fields that class requires with NO default.

_ENGINE_DATA_CLASSES: list[tuple[str, str, str]] = [
    ("start", "graphon.nodes.start.entities", "StartNodeData"),
    ("end", "graphon.nodes.end.entities", "EndNodeData"),
    ("answer", "graphon.nodes.answer.entities", "AnswerNodeData"),
    ("if-else", "graphon.nodes.if_else.entities", "IfElseNodeData"),
    ("code", "graphon.nodes.code.entities", "CodeNodeData"),
    ("template-transform", "graphon.nodes.template_transform.entities", "TemplateTransformNodeData"),
    ("http-request", "graphon.nodes.http_request.entities", "HttpRequestNodeData"),
    ("variable-aggregator", "graphon.nodes.variable_aggregator.entities", "VariableAggregatorNodeData"),
    ("question-classifier", "graphon.nodes.question_classifier.entities", "QuestionClassifierNodeData"),
]


@pytest.mark.parametrize(("node_type", "module_name", "class_name"), _ENGINE_DATA_CLASSES)
def test_the_engine_validates_a_node_built_from_the_default_alone(node_type: str, module_name: str, class_name: str):
    import importlib

    data_class = getattr(importlib.import_module(module_name), class_name)

    data_class.model_validate({"type": node_type, "title": "T", **default_config(node_type)})


def test_the_engine_still_rejects_a_template_transform_without_the_default():
    """The registry entry is load-bearing, not decoration: this is the exact
    shape the Edit LLM emitted in the F4 failure."""
    from pydantic import ValidationError

    from graphon.nodes.template_transform.entities import TemplateTransformNodeData

    with pytest.raises(ValidationError, match="variables"):
        TemplateTransformNodeData.model_validate({"type": "template-transform", "template": "excellent"})


def test_the_engine_still_rejects_a_variable_aggregator_without_an_output_type():
    """``VariableAggregatorNodeData`` requires ``output_type`` as well as
    ``variables``; the frontend default supplies both."""
    from pydantic import ValidationError

    from graphon.nodes.variable_aggregator.entities import VariableAggregatorNodeData

    with pytest.raises(ValidationError, match="output_type"):
        VariableAggregatorNodeData.model_validate({"type": "variable-aggregator", "variables": []})


def test_the_engine_rejects_a_tool_built_from_the_default_alone_for_identity_only():
    """The tool default cannot invent a provider/tool identity -- only the
    caller knows it. Everything the default DOES cover validates."""
    from pydantic import ValidationError

    from graphon.nodes.tool.entities import ToolNodeData

    with pytest.raises(ValidationError) as excinfo:
        ToolNodeData.model_validate({"type": "tool", "title": "T", **default_config("tool")})

    missing = {error["loc"][0] for error in excinfo.value.errors()}
    assert missing == {"provider_id", "provider_type", "provider_name", "tool_name", "tool_label"}

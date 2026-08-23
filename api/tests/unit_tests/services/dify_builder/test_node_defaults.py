"""Tests for the canned Build node-type default-config registry.

Values are pinned against the FE registry they mirror (``web/app/components
/workflow/nodes/<type>/default.ts``) -- see the docstring in
``node_defaults.py`` for the exact source lines.
"""

import pytest

from services.dify_builder.node_defaults import default_config


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


def test_default_config_raises_for_unregistered_node_type():
    with pytest.raises(ValueError, match="code"):
        default_config("code")


def test_default_config_returns_a_fresh_copy_each_call():
    first = default_config("start")
    first["variables"].append({"variable": "mutated"})

    second = default_config("start")

    assert second == {"variables": []}

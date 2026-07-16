import pytest
from pydantic import ValidationError

from dify_agent.layers.knowledge import DifyKnowledgeBaseLayerConfig


def _valid_config() -> dict[str, object]:
    return {
        "sets": [
            {
                "id": "support",
                "name": "Support KB",
                "datasets": [{"id": "dataset-1"}],
                "query": {"mode": "generated_query"},
                "retrieval": {
                    "mode": "multiple",
                    "top_k": 4,
                },
            }
        ],
    }


def test_knowledge_base_config_accepts_valid_multiple_mode() -> None:
    config = DifyKnowledgeBaseLayerConfig.model_validate(_valid_config())

    assert config.sets[0].dataset_ids == ["dataset-1"]
    assert config.sets[0].retrieval.top_k == 4
    assert config.sets[0].metadata_filtering.mode == "disabled"


@pytest.mark.parametrize(
    "payload, expected_message",
    [
        ({"sets": []}, "sets"),
        ({"tool_name": "knowledge_base_search", **_valid_config()}, "Extra inputs are not permitted"),
        ({"tool_description": "Search knowledge", **_valid_config()}, "Extra inputs are not permitted"),
        (
            {
                "sets": [
                    {
                        "id": "support",
                        "name": "Support KB",
                        "datasets": [{"id": ""}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                    }
                ]
            },
            "dataset id",
        ),
        (
            {
                "sets": [
                    {
                        "id": "support",
                        "name": "Support KB",
                        "datasets": [{"id": "dataset-1"}],
                        "query": {"mode": "user_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                    }
                ]
            },
            "query.value",
        ),
        (
            {
                "sets": [
                    {
                        "id": "support",
                        "name": "Support KB",
                        "datasets": [{"id": "dataset-1"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple"},
                    }
                ]
            },
            "top_k",
        ),
        (
            {
                "sets": [
                    {
                        "id": "support",
                        "name": "Support KB",
                        "datasets": [{"id": "dataset-1"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "single"},
                    }
                ]
            },
            "retrieval.model",
        ),
        (
            {
                "sets": [
                    {
                        "id": "support",
                        "name": "Support KB",
                        "datasets": [{"id": "dataset-1"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                        "metadata_filtering": {"mode": "automatic"},
                    }
                ],
            },
            "metadata_filtering.model_config",
        ),
        (
            {
                "sets": [
                    {
                        "id": "support",
                        "name": "Support KB",
                        "datasets": [{"id": "dataset-1"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                        "metadata_filtering": {"mode": "manual"},
                    }
                ],
            },
            "metadata_filtering.conditions",
        ),
        (
            {
                "sets": [
                    {
                        "id": "support",
                        "name": "Support KB",
                        "datasets": [{"id": "dataset-1"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                    },
                    {
                        "id": "docs",
                        "name": "support kb",
                        "datasets": [{"id": "dataset-2"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                    },
                ]
            },
            "names must be unique",
        ),
    ],
)
def test_knowledge_base_config_rejects_invalid_inputs(payload: dict[str, object], expected_message: str) -> None:
    with pytest.raises(ValidationError, match=expected_message):
        _ = DifyKnowledgeBaseLayerConfig.model_validate(payload)


def test_knowledge_base_config_rejects_observation_limit_smaller_than_result_limit() -> None:
    with pytest.raises(ValidationError, match="max_observation_chars"):
        _ = DifyKnowledgeBaseLayerConfig.model_validate(
            {
                **_valid_config(),
                "max_result_content_chars": 50,
                "max_observation_chars": 20,
            }
        )

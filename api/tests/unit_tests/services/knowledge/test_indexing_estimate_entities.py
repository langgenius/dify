import pytest

from services.entities.knowledge_entities.indexing_estimate import (
    EstimateValidationError,
    normalize_indexing_estimate_args,
    normalize_process_rule,
)


def test_normalize_indexing_estimate_args_requires_info_list() -> None:
    with pytest.raises(EstimateValidationError, match="Field required"):
        normalize_indexing_estimate_args({})


def test_normalize_process_rule_sets_empty_rules_for_automatic_mode() -> None:
    normalized = normalize_process_rule({"mode": "automatic", "rules": {"ignored": True}})

    assert normalized["rules"] == {}


@pytest.mark.parametrize("summary_setting", [None, {"enable": None}])
def test_normalize_process_rule_treats_absent_summary_enable_as_no_summary(summary_setting: object) -> None:
    normalized = normalize_process_rule(
        {
            "mode": "automatic",
            "summary_index_setting": summary_setting,
        }
    )

    assert "summary_index_setting" not in normalized


def test_normalize_process_rule_rejects_unknown_pre_processing_rule_id() -> None:
    with pytest.raises(EstimateValidationError):
        normalize_process_rule(
            {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [{"id": "unknown", "enabled": True}],
                    "segmentation": {"separator": "\n", "max_tokens": 128},
                },
            }
        )


def test_normalize_process_rule_deduplicates_custom_rules() -> None:
    normalized = normalize_process_rule(
        {
            "mode": "custom",
            "rules": {
                "pre_processing_rules": [
                    {"id": "remove_stopwords", "enabled": True},
                    {"id": "remove_stopwords", "enabled": False},
                ],
                "segmentation": {"separator": "\n", "max_tokens": 128},
            },
        }
    )

    assert normalized["rules"]["pre_processing_rules"] == [{"id": "remove_stopwords", "enabled": False}]


def test_normalize_process_rule_drops_hierarchical_fields_from_custom_mode() -> None:
    normalized = normalize_process_rule(
        {
            "mode": "custom",
            "rules": {
                "pre_processing_rules": [{"id": "remove_stopwords", "enabled": True}],
                "segmentation": {"separator": "\n", "max_tokens": 128},
                "parent_mode": "full-doc",
                "subchunk_segmentation": {"separator": "###", "max_tokens": 64},
            },
        }
    )

    assert normalized["rules"] == {
        "pre_processing_rules": [{"id": "remove_stopwords", "enabled": True}],
        "segmentation": {"separator": "\n", "max_tokens": 128},
    }


def test_normalize_process_rule_requires_summary_index_provider_name() -> None:
    with pytest.raises(EstimateValidationError, match="Field required"):
        normalize_process_rule(
            {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [{"id": "remove_stopwords", "enabled": True}],
                    "segmentation": {"separator": "\n", "max_tokens": 128},
                },
                "summary_index_setting": {"enable": True, "model_name": "summary-model"},
            }
        )


def test_normalize_process_rule_preserves_hierarchical_fields() -> None:
    normalized = normalize_process_rule(
        {
            "mode": "hierarchical",
            "rules": {
                "pre_processing_rules": [{"id": "remove_stopwords", "enabled": True}],
                "segmentation": {"separator": "\n", "max_tokens": 512},
                "parent_mode": "full-doc",
                "subchunk_segmentation": {"separator": "###", "max_tokens": 128},
            },
        }
    )

    assert normalized["rules"]["parent_mode"] == "full-doc"
    assert normalized["rules"]["subchunk_segmentation"] == {"separator": "###", "max_tokens": 128}


def test_normalize_process_rule_defaults_hierarchical_parent_mode() -> None:
    normalized = normalize_process_rule(
        {
            "mode": "hierarchical",
            "rules": {
                "pre_processing_rules": [{"id": "remove_stopwords", "enabled": True}],
                "segmentation": {"separator": "\n", "max_tokens": 512},
                "subchunk_segmentation": {"separator": "###", "max_tokens": 128},
            },
        }
    )

    assert normalized["rules"]["parent_mode"] == "paragraph"
    assert normalized["rules"]["subchunk_segmentation"] == {"separator": "###", "max_tokens": 128}

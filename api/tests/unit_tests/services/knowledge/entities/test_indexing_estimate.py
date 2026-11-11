import pytest
from sqlalchemy.orm import Session

from core.rag.index_processor.index_processor import IndexProcessorFactory
from core.rag.models.document import Document
from services.knowledge.entities.indexing_estimate import (
    EstimateValidationError,
    normalize_process_rule,
)


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

    rules = normalized["rules"]
    assert isinstance(rules, dict)
    assert rules["pre_processing_rules"] == [{"id": "remove_stopwords", "enabled": False}]


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

    rules = normalized["rules"]
    assert isinstance(rules, dict)
    assert rules["parent_mode"] == "full-doc"
    assert rules["subchunk_segmentation"] == {"separator": "###", "max_tokens": 128}


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

    rules = normalized["rules"]
    assert isinstance(rules, dict)
    assert rules["parent_mode"] == "paragraph"
    assert rules["subchunk_segmentation"] == {"separator": "###", "max_tokens": 128}


def test_estimate_rule_preserves_actual_splitter_overlap_and_legacy_delimiter(sqlite_session: Session) -> None:
    process_rule: dict[str, object] = {
        "mode": "custom",
        "rules": {
            "pre_processing_rules": [],
            "segmentation": {
                "delimiter": "||",
                "max_tokens": 50,
                "chunk_overlap": 37,
            },
        },
    }

    normalized = normalize_process_rule(process_rule)

    rules = normalized["rules"]
    assert isinstance(rules, dict)
    assert rules["segmentation"] == {
        "separator": "||",
        "max_tokens": 50,
        "chunk_overlap": 37,
    }
    processor = IndexProcessorFactory("text_model").init_index_processor()
    content = ("alpha beta gamma delta " * 30) + "||" + ("epsilon zeta eta theta " * 30)

    def transform(rule: dict[str, object]) -> list[Document]:
        return processor.transform(
            [Document(page_content=content, metadata={})],
            None,
            process_rule=rule,
            tenant_id="tenant-1",
            on_upload_file_created=lambda _file_id: None,
            doc_language="English",
            session=sqlite_session,
        )

    actual_chunks = transform(process_rule)
    estimate_chunks = transform(normalized)
    assert len(estimate_chunks) == len(actual_chunks)
    assert len(estimate_chunks) > 1
    assert [chunk.page_content for chunk in estimate_chunks] == [chunk.page_content for chunk in actual_chunks]


@pytest.mark.parametrize(
    ("segmentation", "message"),
    [
        ({"delimiter": "||", "max_tokens": 49, "chunk_overlap": 0}, "between 50"),
        ({"delimiter": "||", "max_tokens": 50, "chunk_overlap": 51}, "larger chunk overlap"),
    ],
)
def test_estimate_and_actual_splitter_reject_the_same_segmentation_boundaries(
    segmentation: dict[str, object], message: str, sqlite_session: Session
) -> None:
    process_rule: dict[str, object] = {
        "mode": "custom",
        "rules": {"pre_processing_rules": [], "segmentation": segmentation},
    }
    normalized = normalize_process_rule(process_rule)
    processor = IndexProcessorFactory("text_model").init_index_processor()

    for rule in (process_rule, normalized):
        with pytest.raises(ValueError, match=message):
            processor.transform(
                [Document(page_content="content", metadata={})],
                None,
                process_rule=rule,
                tenant_id="tenant-1",
                on_upload_file_created=lambda _file_id: None,
                doc_language="English",
                session=sqlite_session,
            )

import pytest
from pydantic import ValidationError

from api.core.rag.entities.processing_entities import (
    ParentMode,
    PreProcessingRule,
    Rule,
    Segmentation,
)


def test_parent_mode_values():
    assert ParentMode.FULL_DOC == "full-doc"
    assert ParentMode.PARAGRAPH == "paragraph"
    assert {m.value for m in ParentMode} == {"full-doc", "paragraph"}


def test_preprocessing_rule_valid():
    rule = PreProcessingRule(id="remove_stopwords", enabled=True)
    assert rule.id == "remove_stopwords"
    assert rule.enabled is True


def test_preprocessing_rule_rejects_invalid_id():
    with pytest.raises(ValidationError):
        PreProcessingRule(id="not_a_real_rule", enabled=True)


def test_preprocessing_rule_all_valid_keys():
    for key in ("remove_stopwords", "remove_extra_spaces", "remove_urls_emails"):
        rule = PreProcessingRule(id=key, enabled=False)
        assert rule.id == key


def test_segmentation_default_separator():
    seg = Segmentation(max_tokens=100)
    assert seg.separator == "\n"
    assert seg.chunk_overlap == 0


def test_segmentation_accepts_delimiter_alias():
    # `delimiter` is accepted via AliasChoices and mapped to `separator`
    seg = Segmentation(max_tokens=100, delimiter="###")
    assert seg.separator == "###"


def test_segmentation_requires_max_tokens():
    with pytest.raises(ValidationError):
        Segmentation()


def test_segmentation_rejects_negative_chunk_overlap():
    with pytest.raises(ValidationError):
        Segmentation(max_tokens=10, chunk_overlap=-1)


def test_rule_nested_segmentation():
    rule = Rule(
        segmentation=Segmentation(max_tokens=200, separator="\n\n"),
        parent_mode="full-doc",
    )
    assert rule.segmentation.max_tokens == 200
    assert rule.parent_mode == "full-doc"
    assert rule.pre_processing_rules is None
    assert rule.subchunk_segmentation is None


def test_rule_pre_processing_rules_list():
    rule = Rule(
        pre_processing_rules=[
            PreProcessingRule(id="remove_extra_spaces", enabled=True),
            PreProcessingRule(id="remove_urls_emails", enabled=False),
        ]
    )
    assert len(rule.pre_processing_rules) == 2
    assert rule.pre_processing_rules[0].enabled is True


def test_rule_rejects_invalid_parent_mode():
    with pytest.raises(ValidationError):
        Rule(parent_mode="diagonal")


def test_rule_subchunk_segmentation_alias_same_model():
    sub = Segmentation(max_tokens=50)
    rule = Rule(subchunk_segmentation=sub)
    assert rule.subchunk_segmentation.max_tokens == 50

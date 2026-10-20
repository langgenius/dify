from fields.document_fields import DocumentProcessRuleResponse, DocumentSourceDetailResponse


def test_process_rule_reads_the_legacy_delimiter_as_separator() -> None:
    rule = DocumentProcessRuleResponse.model_validate(
        {
            "mode": "custom",
            "rules": {
                "pre_processing_rules": [{"id": "remove_extra_spaces", "enabled": True}],
                "segmentation": {"delimiter": "\n\n", "max_tokens": 500},
            },
        }
    )

    assert rule.model_dump(mode="json") == {
        "mode": "custom",
        "rules": {
            "pre_processing_rules": [{"id": "remove_extra_spaces", "enabled": True}],
            "segmentation": {"separator": "\n\n", "max_tokens": 500, "chunk_overlap": 0},
            "parent_mode": None,
            "subchunk_segmentation": None,
        },
    }


def test_source_detail_keeps_notion_and_website_source_info() -> None:
    detail = DocumentSourceDetailResponse.model_validate({"url": "https://example.com", "title": "Example"})

    assert detail.model_dump(mode="json") == {"url": "https://example.com", "title": "Example"}

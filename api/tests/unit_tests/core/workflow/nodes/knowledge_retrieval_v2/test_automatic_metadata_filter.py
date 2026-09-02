from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.credit_usage import CreditUsageAppType, CreditUsageCreatedBy
from core.llm_generator.output_parser.errors import OutputParserError
from core.workflow.nodes.knowledge_retrieval_v2 import automatic_metadata_filter as module
from core.workflow.nodes.knowledge_retrieval_v2.automatic_metadata_filter import (
    KnowledgeFSAutomaticMetadataFilterExtractor,
    KnowledgeFSMetadataFieldRef,
    build_metadata_filter_prompt,
    intersect_metadata_fields,
    llm_result_text,
    parse_metadata_map,
    to_custom_metadata_conditions,
)
from core.workflow.nodes.knowledge_retrieval_v2.exc import KnowledgeFSRetrievalConfigurationError
from graphon.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessageRole,
    TextPromptMessageContent,
)
from graphon.nodes.llm.entities import ModelConfig
from services.knowledge_fs.product_dto import KnowledgeFSMetadataFieldResponse


def _field(name: str, field_type: str) -> KnowledgeFSMetadataFieldResponse:
    return KnowledgeFSMetadataFieldResponse.model_validate(
        {
            "count": 1,
            "createdAt": "2026-01-01T00:00:00Z",
            "id": f"field-{name}",
            "name": name,
            "rowVersion": 1,
            "type": field_type,
            "updatedAt": "2026-01-01T00:00:00Z",
        }
    )


def _catalog(*fields: tuple[str, str]) -> list[KnowledgeFSMetadataFieldRef]:
    return [KnowledgeFSMetadataFieldRef(name=name, type=field_type) for name, field_type in fields]  # type: ignore[arg-type]


def test_intersect_metadata_fields_keeps_only_fields_shared_with_identical_types() -> None:
    fields = intersect_metadata_fields(
        [
            [_field("department", "string"), _field("year", "number"), _field("department", "string")],
            [_field("year", "string"), _field("department", "string"), _field("extra", "time")],
        ]
    )

    assert fields == [KnowledgeFSMetadataFieldRef(name="department", type="string")]
    assert intersect_metadata_fields([]) == []
    assert intersect_metadata_fields([[_field("only", "time")]]) == _catalog(("only", "time"))


def test_build_metadata_filter_prompt_mirrors_legacy_chat_and_completion_templates() -> None:
    model_config = SimpleNamespace(stop=["</json>"])

    chat_messages, chat_stop = build_metadata_filter_prompt(
        model_config=model_config,  # type: ignore[arg-type]
        mode="chat",
        field_names=["department", "year"],
        query="finance reports from 2024",
    )
    completion_messages, _ = build_metadata_filter_prompt(
        model_config=model_config,  # type: ignore[arg-type]
        mode="completion",
        field_names=["department"],
        query="finance reports",
    )

    # The shared transform appends the raw query as a trailing user turn, exactly like the legacy node.
    assert [message.role for message in chat_messages] == [
        PromptMessageRole.SYSTEM,
        PromptMessageRole.USER,
        PromptMessageRole.ASSISTANT,
        PromptMessageRole.USER,
        PromptMessageRole.ASSISTANT,
        PromptMessageRole.USER,
        PromptMessageRole.USER,
    ]
    extraction_request = chat_messages[5].content
    assert isinstance(extraction_request, str)
    assert "finance reports from 2024" in extraction_request
    assert json.dumps(["department", "year"]) in extraction_request
    assert chat_messages[-1].content == "finance reports from 2024"
    assert chat_stop == ["</json>"]
    assert len(completion_messages) == 1
    completion_text = completion_messages[0].content
    assert isinstance(completion_text, str)
    assert "finance reports" in completion_text
    assert json.dumps(["department"]) in completion_text
    with pytest.raises(ValueError):
        build_metadata_filter_prompt(
            model_config=model_config,  # type: ignore[arg-type]
            mode="unknown",
            field_names=[],
            query="q",
        )


def test_parse_metadata_map_accepts_markdown_wrapped_json_and_ignores_junk() -> None:
    text = (
        "Here you go:\n```json\n"
        '{"metadata_map": [{"metadata_field_name": "year", "metadata_field_value": 2024, '
        '"comparison_operator": "="}, "junk", 42]}\n```'
    )

    assert parse_metadata_map(text) == [
        {"metadata_field_name": "year", "metadata_field_value": 2024, "comparison_operator": "="}
    ]
    assert parse_metadata_map('{"metadata_map": {"not": "a list"}}') == []
    assert parse_metadata_map('[{"metadata_map": []}]') == []
    with pytest.raises(ValueError):
        parse_metadata_map("not json at all")
    with pytest.raises(OutputParserError):
        parse_metadata_map("[]")


def test_llm_result_text_flattens_text_content_parts() -> None:
    usage = LLMUsage.empty_usage()
    plain = LLMResult(model="m", message=AssistantPromptMessage(content="plain"), usage=usage)
    parts = LLMResult(
        model="m",
        message=AssistantPromptMessage(
            content=[TextPromptMessageContent(data='{"metadata_map": '), TextPromptMessageContent(data="[]}")]
        ),
        usage=usage,
    )

    assert llm_result_text(plain) == "plain"
    assert llm_result_text(parts) == '{"metadata_map": []}'


def test_to_custom_metadata_conditions_normalizes_operators_and_values_per_field_type() -> None:
    catalog = _catalog(("department", "string"), ("year", "number"), ("published_at", "time"))
    conditions = to_custom_metadata_conditions(
        [
            {"metadata_field_name": "department", "metadata_field_value": "finance", "comparison_operator": "=="},
            {"metadata_field_name": "department", "metadata_field_value": 12, "comparison_operator": "Contains"},
            {"metadata_field_name": "year", "metadata_field_value": "2024", "comparison_operator": ">="},
            {"metadata_field_name": "year", "metadata_field_value": "2024.5", "comparison_operator": "<"},
            {"metadata_field_name": "year", "metadata_field_value": "later", "comparison_operator": "="},
            {"metadata_field_name": "published_at", "metadata_field_value": "2024-01-01", "comparison_operator": "<="},
            {"metadata_field_name": "published_at", "metadata_field_value": 1704067200, "comparison_operator": "is"},
            {"metadata_field_name": "published_at", "metadata_field_value": "yesterday", "comparison_operator": ">"},
            {"metadata_field_name": "published_at", "metadata_field_value": "ignored", "comparison_operator": "empty"},
            {"metadata_field_name": "unknown", "metadata_field_value": "x", "comparison_operator": "is"},
            {"metadata_field_name": "department", "metadata_field_value": "x", "comparison_operator": "matches"},
            {"metadata_field_name": "department", "metadata_field_value": True, "comparison_operator": "is"},
            {"metadata_field_value": "x", "comparison_operator": "is"},
            {"metadata_field_name": 12, "metadata_field_value": "x", "comparison_operator": "is"},
        ],
        catalog,
    )

    assert [condition.model_dump(by_alias=True, exclude_none=True) for condition in conditions] == [
        {"comparisonOperator": "is", "fieldType": "string", "name": "department", "value": "finance"},
        {"comparisonOperator": "contains", "fieldType": "string", "name": "department", "value": "12"},
        {"comparisonOperator": "≥", "fieldType": "number", "name": "year", "value": 2024},
        {"comparisonOperator": "<", "fieldType": "number", "name": "year", "value": 2024.5},
        {"comparisonOperator": "before", "fieldType": "time", "name": "published_at", "value": "2024-01-01"},
        {"comparisonOperator": "is", "fieldType": "time", "name": "published_at", "value": 1704067200},
        {"comparisonOperator": "empty", "fieldType": "time", "name": "published_at"},
    ]


class RecordingModelInstance:
    provider = "openai"
    model_name = "gpt-4o-mini"

    def __init__(self, text: str) -> None:
        self.text = text
        self.calls: list[dict[str, object]] = []

    def invoke_llm(self, **kwargs: object) -> LLMResult:
        self.calls.append(kwargs)
        return LLMResult(
            model=self.model_name,
            message=AssistantPromptMessage(content=self.text),
            usage=LLMUsage.empty_usage().model_copy(update={"total_tokens": 7}),
        )


def _run_context() -> DifyRunContext:
    return DifyRunContext(
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="user-1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )


def test_extractor_invokes_the_configured_model_with_the_legacy_prompt_and_credit_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_instance = RecordingModelInstance(
        '{"metadata_map": [{"metadata_field_name": "department", "metadata_field_value": "finance", '
        '"comparison_operator": "="}]}'
    )
    model_config_entity = SimpleNamespace(parameters={"temperature": 0.2}, stop=["END"])
    fetched: list[dict[str, object]] = []

    def fake_fetch_model_config(**kwargs: object) -> tuple[object, object]:
        fetched.append(kwargs)
        return model_instance, model_config_entity

    monkeypatch.setattr(module, "fetch_model_config", fake_fetch_model_config)
    extractor = KnowledgeFSAutomaticMetadataFilterExtractor(
        credentials_provider=object(),  # type: ignore[arg-type]
        model_factory=object(),  # type: ignore[arg-type]
    )

    extraction = extractor.extract(
        run_context=_run_context(),
        model_config=ModelConfig(provider="openai", name="gpt-4o-mini", mode=LLMMode.CHAT, completion_params={}),
        query="finance reports",
        field_names=["department"],
    )

    assert fetched[0]["node_data_model"].name == "gpt-4o-mini"  # type: ignore[attr-defined]
    assert extraction.metadata_map == [
        {"metadata_field_name": "department", "metadata_field_value": "finance", "comparison_operator": "="}
    ]
    assert extraction.usage.total_tokens == 7
    assert extraction.model == "gpt-4o-mini"
    assert extraction.provider == "openai"
    call = model_instance.calls[0]
    assert call["model_parameters"] == {"temperature": 0.2}
    assert call["stop"] == ["END"]
    assert call["stream"] is False
    assert call["request_metadata"] == {
        "app_id": "app-1",
        "app_type": CreditUsageAppType.UNKNOWN,
        "created_by": CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL,
    }
    prompt_messages = call["prompt_messages"]
    assert isinstance(prompt_messages, list)
    assert prompt_messages[0].role == PromptMessageRole.SYSTEM
    assert "finance reports" in prompt_messages[-1].content


def test_extractor_reports_missing_model_as_a_configuration_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_fetch_model_config(**_kwargs: object) -> tuple[object, object]:
        raise ValueError("Model gpt-4o-mini does not exist.")

    monkeypatch.setattr(module, "fetch_model_config", fail_fetch_model_config)
    extractor = KnowledgeFSAutomaticMetadataFilterExtractor(
        credentials_provider=object(),  # type: ignore[arg-type]
        model_factory=object(),  # type: ignore[arg-type]
    )

    with pytest.raises(KnowledgeFSRetrievalConfigurationError):
        extractor.extract(
            run_context=_run_context(),
            model_config=ModelConfig(provider="openai", name="gpt-4o-mini", mode=LLMMode.CHAT, completion_params={}),
            query="finance reports",
            field_names=["department"],
        )

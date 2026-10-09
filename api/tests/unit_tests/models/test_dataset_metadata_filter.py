import json

import pytest

from core.rag.retrieval import template_prompts
from models.dataset_metadata_filter import (
    METADATA_OPERATORS,
    MetadataField,
    MetadataFilterGenerationError,
    metadata_prompt_fields,
    shared_metadata_fields,
    validate_automatic_metadata_filters,
)


class TestAutomaticMetadataPolicy:
    def test_every_advertised_operator_accepts_its_documented_value_format(self) -> None:
        for kind, operators in METADATA_OPERATORS.items():
            for operator in operators:
                if operator in {"empty", "not empty"}:
                    value = None
                elif kind == "string":
                    value = ["news"] if operator in {"in", "not in"} else "news"
                else:
                    value = 1791540000 if kind == "time" else 9
                result = validate_automatic_metadata_filters(
                    {
                        "metadata_map": [
                            {
                                "metadata_field_name": "field",
                                "comparison_operator": operator,
                                "metadata_field_value": value,
                            }
                        ]
                    },
                    {"field": kind},
                )
                assert result == [{"metadata_name": "field", "condition": operator, "value": value}]
        for condition in [
            {"metadata_field_name": "field", "comparison_operator": "empty"},
            {"metadata_field_name": "field", "comparison_operator": "empty", "metadata_field_value": "wrong"},
        ]:
            with pytest.raises(MetadataFilterGenerationError):
                validate_automatic_metadata_filters({"metadata_map": [condition]}, {"field": "string"})

    def test_real_chat_examples_follow_the_validator_contract(self) -> None:
        for user, assistant in [
            (template_prompts.METADATA_FILTER_USER_PROMPT_1, template_prompts.METADATA_FILTER_ASSISTANT_PROMPT_1),
            (template_prompts.METADATA_FILTER_USER_PROMPT_2, template_prompts.METADATA_FILTER_ASSISTANT_PROMPT_2),
            (template_prompts.METADATA_FILTER_USER_PROMPT_4, template_prompts.METADATA_FILTER_ASSISTANT_PROMPT_4),
        ]:
            schema = json.loads(user)["metadata_fields"]
            assert all(field["operators"] == list(METADATA_OPERATORS[field["type"]]) for field in schema)
            fields = {field["name"]: field["type"] for field in schema}
            result = json.loads(assistant)
            conditions = validate_automatic_metadata_filters(result, fields)
            assert len(conditions) == len(result["metadata_map"])
        movie_conditions = json.loads(template_prompts.METADATA_FILTER_ASSISTANT_PROMPT_2)["metadata_map"]
        assert [item["metadata_field_value"] for item in movie_conditions] == [2024, 9]
        assert (
            validate_automatic_metadata_filters(
                json.loads(template_prompts.METADATA_FILTER_ASSISTANT_PROMPT_4), {"year": "number"}
            )
            == []
        )

    def test_real_completion_examples_and_runtime_input_follow_the_same_contract(self) -> None:
        query = 'Movies with "quotes", a newline\n and {braces}'
        fields = {"email": "string", "rating": "number", "created": "time"}
        encoded_schema = json.dumps(metadata_prompt_fields(fields))
        prompt = template_prompts.METADATA_FILTER_COMPLETION_PROMPT.format(
            input_text=json.dumps(query), metadata_fields=encoded_schema
        )
        examples = prompt.split("<example>\n", 1)[1].split("</example>", 1)[0].strip().splitlines()
        for user_line, assistant_line in zip(examples[::2], examples[1::2], strict=True):
            schema = json.loads(user_line.removeprefix("User:"))["metadata_fields"]
            conditions = json.loads(assistant_line.removeprefix("Assistant:"))
            validate_automatic_metadata_filters(conditions, {field["name"]: field["type"] for field in schema})
        runtime_input = json.loads(prompt.split("### User Input\n", 1)[1].split("### Assistant Output", 1)[0])
        assert runtime_input["input_text"] == query
        assert runtime_input["metadata_fields"] == metadata_prompt_fields(fields)
        chat_input = template_prompts.METADATA_FILTER_USER_PROMPT_3.format(
            input_text=json.dumps(query), metadata_fields=encoded_schema
        )
        assert json.loads(chat_input) == runtime_input
        assert template_prompts.METADATA_FILTER_SYSTEM_PROMPT in prompt
        assert template_prompts.METADATA_FILTER_ASSISTANT_PROMPT_4 in prompt

    def test_unsupported_prompt_schema_and_legacy_ambiguous_values_are_rejected(self) -> None:
        with pytest.raises(MetadataFilterGenerationError):
            metadata_prompt_fields({"field": "unknown"})
        for name, operator, value in [("email", "=", "test@example.com"), ("year", "=", "2024")]:
            with pytest.raises(MetadataFilterGenerationError):
                validate_automatic_metadata_filters(
                    {
                        "metadata_map": [
                            {
                                "metadata_field_name": name,
                                "comparison_operator": operator,
                                "metadata_field_value": value,
                            }
                        ]
                    },
                    {"email": "string", "year": "number"},
                )

    def test_strict_intersection_including_missing_schemas(self) -> None:
        fields = [
            MetadataField(dataset_id="a", name="author", type="string"),
            MetadataField(dataset_id="b", name="author", type="string"),
            MetadataField(dataset_id="a", name="score", type="number"),
            MetadataField(dataset_id="b", name="score", type="string"),
            MetadataField(dataset_id="other", name="private", type="string"),
        ]
        assert shared_metadata_fields(["a", "b"], fields) == {"author": "string"}
        assert shared_metadata_fields(["a", "missing"], fields) == {}

    def test_empty_map_is_valid_but_missing_or_malformed_map_is_not(self) -> None:
        assert validate_automatic_metadata_filters({"metadata_map": []}, {}) == []
        for result in [
            dict[str, object](),
            list[object](),
            None,
            dict[str, object](metadata_map=None),
            dict[str, object](metadata_map=dict[str, object]()),
            dict[str, object](metadata_map=list[object]([None])),
        ]:
            with pytest.raises(MetadataFilterGenerationError):
                validate_automatic_metadata_filters(result, {})

    def test_generated_fields_operators_and_values_are_validated(self) -> None:
        fields = {"author": "string", "score": "number", "date": "time"}
        invalid = [
            ("missing", "is", "x"),
            ("author", ">", "x"),
            ("author", "is", 1),
            ("author", "in", ["x", 1]),
            ("score", "=", "1"),
            ("score", "=", True),
            ("score", "=", float("nan")),
            ("date", "before", None),
            ("date", "contains", 1),
        ]
        for name, operator, value in invalid:
            with pytest.raises(MetadataFilterGenerationError):
                validate_automatic_metadata_filters(
                    {
                        "metadata_map": [
                            {
                                "metadata_field_name": name,
                                "comparison_operator": operator,
                                "metadata_field_value": value,
                            }
                        ]
                    },
                    fields,
                )
        assert validate_automatic_metadata_filters(
            {"metadata_map": [{"metadata_field_name": "score", "comparison_operator": ">", "metadata_field_value": 3}]},
            fields,
        ) == [{"metadata_name": "score", "condition": ">", "value": 3}]

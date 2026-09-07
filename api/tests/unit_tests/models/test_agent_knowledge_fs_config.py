"""KnowledgeFS authoring and historical snapshot decoding contracts."""

import pytest
from pydantic import ValidationError

from models.agent_config_entities import AgentKnowledgeSpaceConfig, AgentSoulConfig, AgentSoulKnowledgeConfig


def binding(**overrides: object) -> dict[str, object]:
    return {
        "id": "product",
        "control_space_id": "ba0b32b1-6c20-493b-96a7-f2d0031f6ba9",
        "name": "产品文档",
        **overrides,
    }


def test_knowledge_fs_round_trip_keeps_identity_and_missing_references() -> None:
    soul = AgentSoulConfig.model_validate({"knowledge": {"spaces": [binding(is_missing=True)]}})
    restored = AgentSoulConfig.model_validate_json(soul.model_dump_json())
    assert restored.knowledge == soul.knowledge
    assert restored.knowledge.spaces[0].is_missing
    assert restored.knowledge.sets == []


@pytest.mark.parametrize("value", ["bad-id", "../space", "00000000-0000-0000-0000-not-a-uuid00"])
def test_invalid_control_space_identifiers_are_rejected(value: str) -> None:
    with pytest.raises(ValidationError):
        AgentKnowledgeSpaceConfig.model_validate(binding(control_space_id=value))


@pytest.mark.parametrize("field", ["id", "name"])
@pytest.mark.parametrize("value", [" ", "line\nbreak", "null\x00byte"])
def test_alias_and_identity_cannot_inject_control_characters(field: str, value: str) -> None:
    with pytest.raises(ValidationError):
        AgentKnowledgeSpaceConfig.model_validate(binding(**{field: value}))


@pytest.mark.parametrize(
    ("field", "value"),
    [("id", "PRODUCT"), ("name", "产品文档"), ("control_space_id", "ba0b32b1-6c20-493b-96a7-f2d0031f6ba9")],
)
def test_duplicate_binding_identity_is_rejected(field: str, value: str) -> None:
    second = binding(id="second", name="Policies", control_space_id="a84a7a42-773a-4ce1-8c30-6b932bc7d6d3")
    second[field] = value
    with pytest.raises(ValidationError, match="unique"):
        AgentSoulKnowledgeConfig.model_validate({"spaces": [binding(), second]})


def test_alias_cannot_shadow_another_stable_id() -> None:
    with pytest.raises(ValidationError, match="shadow"):
        AgentSoulKnowledgeConfig.model_validate(
            {
                "spaces": [
                    binding(),
                    binding(
                        id="second",
                        name="PRODUCT",
                        control_space_id="a84a7a42-773a-4ce1-8c30-6b932bc7d6d3",
                    ),
                ]
            }
        )


def test_empty_historical_knowledge_is_still_readable() -> None:
    assert AgentSoulKnowledgeConfig.model_validate({"sets": []}).spaces == []


def test_mixed_legacy_and_knowledge_fs_config_fails_explicitly() -> None:
    with pytest.raises(ValidationError, match="cannot be mixed"):
        AgentSoulKnowledgeConfig.model_validate(
            {
                "spaces": [binding()],
                "sets": [
                    {
                        "id": "old",
                        "name": "Old",
                        "datasets": [{"id": "old-dataset"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 5},
                    }
                ],
            }
        )

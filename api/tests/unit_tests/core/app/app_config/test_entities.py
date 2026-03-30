import pytest
from graphon.variables.input_entities import VariableEntity, VariableEntityType

from core.app.app_config.entities import (
    DatasetRetrieveConfigEntity,
    PromptTemplateEntity,
)


class TestAppConfigEntities:
    def test_variable_entity_coerces_none_description_and_options(self):
        entity = VariableEntity(
            variable="query",
            label="Query",
            description=None,
            type=VariableEntityType.TEXT_INPUT,
            options=None,
        )

        assert entity.description == ""
        assert entity.options == []

    def test_variable_entity_rejects_invalid_json_schema(self):
        with pytest.raises(ValueError):
            VariableEntity(
                variable="query",
                label="Query",
                type=VariableEntityType.TEXT_INPUT,
                json_schema={"type": "string", "minLength": "bad"},
            )

    def test_prompt_template_value_of(self):
        assert PromptTemplateEntity.PromptType.value_of("simple") == PromptTemplateEntity.PromptType.SIMPLE
        with pytest.raises(ValueError):
            PromptTemplateEntity.PromptType.value_of("missing")

    def test_dataset_retrieve_strategy_value_of(self):
        assert (
            DatasetRetrieveConfigEntity.RetrieveStrategy.value_of("single")
            == DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE
        )
        with pytest.raises(ValueError):
            DatasetRetrieveConfigEntity.RetrieveStrategy.value_of("missing")

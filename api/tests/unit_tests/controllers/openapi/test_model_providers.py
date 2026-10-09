from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from controllers.openapi._models import ModelListQuery
from controllers.openapi._search import matches
from controllers.openapi.model_providers import _provider_write_response, model_rows
from core.entities.model_entities import ModelStatus, ModelWithProviderEntity, SimpleModelProviderEntity
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import FetchFrom, ModelType


def _model(
    name: str, *, provider: str = "langgenius/openai/openai", deprecated: bool = False
) -> ModelWithProviderEntity:
    data: dict[str, object] = {
        "model": name,
        "label": {"en_US": name.upper()},
        "model_type": ModelType.LLM,
        "features": [],
        "fetch_from": FetchFrom.PREDEFINED_MODEL,
        "model_properties": {},
        "deprecated": deprecated,
        "status": ModelStatus.ACTIVE,
        "load_balancing_enabled": False,
        "has_invalid_load_balancing_configs": False,
    }
    # The entity's __init__ takes a ProviderEntity; build the short form directly.
    simple = SimpleModelProviderEntity.model_construct(
        provider=provider, label=I18nObject(en_US="OpenAI"), supported_model_types=[ModelType.LLM]
    )
    return ModelWithProviderEntity.model_validate({**data, "provider": simple})


def test_rows_carry_their_provider() -> None:
    [row] = model_rows([_model("gpt-4o")], words="", language=None)
    assert (row.provider, row.provider_label, row.model, row.label) == (
        "langgenius/openai/openai",
        "OpenAI",
        "gpt-4o",
        "GPT-4O",
    )


def test_deprecated_models_are_left_out() -> None:
    rows = model_rows([_model("gpt-4o"), _model("gpt-3", deprecated=True)], words="", language=None)
    assert [r.model for r in rows] == ["gpt-4o"]


def test_query_matches_model_label_or_provider() -> None:
    models = [_model("gpt-4o"), _model("claude", provider="langgenius/anthropic/anthropic")]
    assert [r.model for r in model_rows(models, words="anthropic", language=None)] == ["claude"]
    assert [r.model for r in model_rows(models, words="GPT", language=None)] == ["gpt-4o"]


def test_unknown_model_type_is_rejected() -> None:
    with pytest.raises(ValidationError):
        ModelListQuery.model_validate({"model_type": "video"})


def test_matches_ignores_case_and_none() -> None:
    assert matches("Git", None, "github")
    assert matches("", None)
    assert not matches("slack", "github", None)


def test_inactive_credential_hints_replace_active() -> None:
    configuration = SimpleNamespace(
        current_credential_id="active-id",
        available_credentials=[
            SimpleNamespace(credential_id="active-id", credential_name="main"),
            SimpleNamespace(credential_id="new-id", credential_name="spare"),
        ],
    )
    with patch(
        "controllers.openapi.model_providers._provider",
        return_value=SimpleNamespace(custom_configuration=configuration),
    ):
        response = _provider_write_response("ws", "langgenius/openai/openai", "new-id")
    [hint] = response.hints
    assert not response.active
    assert hint.op == "set.model_provider.credential"
    assert hint.input["credential_id"] == "active-id"

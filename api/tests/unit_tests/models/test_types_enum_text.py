from typing import Any, cast

import pytest
from graphon.model_runtime.entities.model_entities import ModelType

from models.types import EnumText


class TestEnumText:
    def test_process_bind_param_normalizes_legacy_model_type_alias(self) -> None:
        enum_text = EnumText(ModelType, length=40)

        result = enum_text.process_bind_param("reranking", cast(Any, None))

        assert result == ModelType.RERANK.value

    def test_process_result_value_normalizes_legacy_model_type_alias(self) -> None:
        enum_text = EnumText(ModelType, length=40)

        result = enum_text.process_result_value("reranking", cast(Any, None))

        assert result == ModelType.RERANK

    def test_process_result_value_still_raises_for_unknown_value(self) -> None:
        enum_text = EnumText(ModelType, length=40)

        with pytest.raises(ValueError, match="invalid origin model type invalid-model-type"):
            enum_text.process_result_value("invalid-model-type", cast(Any, None))

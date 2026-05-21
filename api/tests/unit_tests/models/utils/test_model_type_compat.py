from sqlalchemy.dialects import postgresql

from graphon.model_runtime.entities.model_entities import ModelType
from models.provider import ProviderModelCredential
from models.utils.model_type_compat import legacy_compatible_model_type_filter


def test_legacy_compatible_model_type_filter_matches_canonical_and_legacy_values():
    expr = legacy_compatible_model_type_filter(ProviderModelCredential.model_type, ModelType.LLM)
    compiled = str(expr.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))

    assert "'llm'" in compiled
    assert "text-generation" in compiled
    # Ensure that the generated does not rely on SQL cast
    assert "cast" not in compiled

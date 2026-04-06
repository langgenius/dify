from graphon.model_runtime.entities.model_entities import ModelType
from sqlalchemy.dialects.postgresql import dialect as pg_dialect

from models.model_type_enum_text import ModelTypeEnumText


def test_model_type_enum_text_maps_legacy_embeddings():
    col = ModelTypeEnumText(length=40)
    d = pg_dialect()

    assert col.process_result_value("embeddings", d) == ModelType.TEXT_EMBEDDING
    assert col.process_result_value("text-embedding", d) == ModelType.TEXT_EMBEDDING


def test_model_type_enum_text_bind_normalizes_legacy_string():
    col = ModelTypeEnumText(length=40)
    d = pg_dialect()

    assert col.process_bind_param("embeddings", d) == ModelType.TEXT_EMBEDDING.value
    assert col.process_bind_param(ModelType.TEXT_EMBEDDING, d) == ModelType.TEXT_EMBEDDING.value

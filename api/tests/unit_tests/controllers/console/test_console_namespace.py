import pytest
from pydantic import BaseModel, Field

from controllers.common.schema import query_params_from_model, register_schema_models
from controllers.console import ConsoleNamespace


class _Payload(BaseModel):
    name: str


class _Unregistered(BaseModel):
    name: str


class _Query(BaseModel):
    page: int = Field(default=1, ge=1, description="Page number")


def test_expect_model_matches_expanded_expect_decorator() -> None:
    ns = ConsoleNamespace("test")
    register_schema_models(ns, _Payload)

    helper = ns.expect_model(_Payload, validate=True)(lambda: None).__apidoc__
    expanded = ns.expect(ns.models[_Payload.__name__], validate=True)(lambda: None).__apidoc__

    assert helper["validate"] is expanded["validate"] is True
    assert [(m.name, m.__schema__) for m in helper["expect"]] == [(m.name, m.__schema__) for m in expanded["expect"]]
    assert helper["expect"][0].name == "_Payload"


def test_expect_model_raises_key_error_for_unregistered_model() -> None:
    ns = ConsoleNamespace("test")

    with pytest.raises(KeyError, match="_Unregistered"):
        ns.expect_model(_Unregistered)


def test_doc_query_documents_query_params_from_model() -> None:
    ns = ConsoleNamespace("test")

    decorated = ns.doc_query(_Query)(lambda: None)

    assert decorated.__apidoc__ == {"params": query_params_from_model(_Query)}

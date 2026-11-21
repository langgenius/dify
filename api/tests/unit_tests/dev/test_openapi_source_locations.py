"""Editor metadata must follow registered Python identities without changing live schemas."""

import inspect
from collections.abc import Callable
from copy import deepcopy
from functools import wraps
from pathlib import Path

from flask_restx import Api, Namespace, Resource
from pydantic import BaseModel

from controllers.common.schema import register_schema_model, registered_schema_sources
from dev.export_console_openapi import attach_api_sources, resolve_source_type, source_location


class NavigationPayload(BaseModel):
    name: str


class Container:
    class Nested(BaseModel):
        value: str


def decorated[**P, R](handler: Callable[P, R]) -> Callable[P, R]:
    @wraps(handler)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        return handler(*args, **kwargs)

    return wrapper


class NavigationResource(Resource):
    @decorated
    def post(self) -> dict[str, str]:
        return {}


def test_registered_models_and_decorated_operations_have_exact_origins() -> None:
    namespace = Namespace("navigation", path="/navigation")
    register_schema_model(namespace, NavigationPayload)
    namespace.add_resource(NavigationResource, "")
    api = Api()
    api.add_namespace(namespace)
    live_schema = deepcopy(namespace.models["NavigationPayload"].__schema__)
    document = {
        "components": {"schemas": {"NavigationPayload": deepcopy(live_schema), "Synthetic": {"type": "object"}}},
        "paths": {"/navigation": {"post": {"description": "Create"}}},
    }

    attach_api_sources(document, api)

    model_source = document["components"]["schemas"]["NavigationPayload"]["x-source-location"]
    assert model_source == {"file": str(Path(__file__).resolve()), "line": inspect.getsourcelines(NavigationPayload)[1]}
    operation_source = document["paths"]["/navigation"]["post"]["x-source-location"]
    expected_line = next(
        line
        for line, text in enumerate(Path(__file__).read_text().splitlines(), 1)
        if text.strip() == "def post(self) -> dict[str, str]:"
    )
    assert operation_source == {"file": str(Path(__file__).resolve()), "line": expected_line}
    assert "x-source-location" not in document["components"]["schemas"]["Synthetic"]
    assert namespace.models["NavigationPayload"].__schema__ == live_schema
    sources = registered_schema_sources(namespace)
    sources.clear()
    assert registered_schema_sources(namespace)["NavigationPayload"].endswith(".NavigationPayload")


def test_exact_nested_and_generic_identities_resolve_without_name_guessing() -> None:
    assert resolve_source_type(f"{__name__}.Container.Nested") is Container.Nested
    assert resolve_source_type(f"{__name__}.Container.Nested[builtins.str]") is Container.Nested
    assert resolve_source_type("unknown.module.NavigationPayload") is None
    assert resolve_source_type(f"{__name__}.Missing.NavigationPayload") is None
    assert source_location(None) is None
    assert source_location(str) is None

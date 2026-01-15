"""Helpers for registering Pydantic models with Flask-RESTX namespaces."""

from flask_restx import Namespace
from pydantic import BaseModel

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


def register_schema_model(namespace: Namespace, model: type[BaseModel]) -> None:
    """Register a single BaseModel with a namespace for Swagger documentation."""

    namespace.schema_model(model.__name__, model.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


def register_schema_models(namespace: Namespace, *models: type[BaseModel]) -> None:
    """Register multiple BaseModels with a namespace."""

    for model in models:
        register_schema_model(namespace, model)


__all__ = [
    "DEFAULT_REF_TEMPLATE_SWAGGER_2_0",
    "register_schema_model",
    "register_schema_models",
]

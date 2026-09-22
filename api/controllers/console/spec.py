from collections.abc import Mapping
from http import HTTPStatus
from typing import Any

from flask_restx import Resource
from pydantic import Field, RootModel

from controllers.common.schema import register_response_schema_models
from controllers.console.flask_admission import console_account_admission
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from machinery.context import RequestContext

from . import console_ns


class SchemaDefinitionItemResponse(ResponseModel):
    name: str
    label: str
    schema_: Mapping[str, Any] = Field(alias="schema")


class SchemaDefinitionsResponse(RootModel[list[SchemaDefinitionItemResponse]]):
    pass


register_response_schema_models(console_ns, SchemaDefinitionItemResponse, SchemaDefinitionsResponse)


@console_ns.route("/spec/schema-definitions")
class SpecSchemaDefinitionsApi(Resource):
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SchemaDefinitionsResponse.__name__])
    @console_account_admission()
    def get(self, _request_context: RequestContext):
        """
        Get system JSON Schema definitions specification
        Used for frontend component type mapping
        """
        schema_definitions = application_services().schema_definitions.list()
        response = SchemaDefinitionsResponse.model_validate(schema_definitions).model_dump(mode="json")
        return response, HTTPStatus.OK

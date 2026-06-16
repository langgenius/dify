import logging
from typing import Any

from flask_restx import Resource
from pydantic import RootModel

from controllers.common.schema import register_response_schema_models
from controllers.console.wraps import (
    account_initialization_required,
    setup_required,
)
from core.schemas.schema_manager import SchemaManager
from libs.login import login_required

from . import console_ns

logger = logging.getLogger(__name__)


class SchemaDefinitionsResponse(RootModel[Any]):
    root: Any


register_response_schema_models(console_ns, SchemaDefinitionsResponse)


@console_ns.route("/spec/schema-definitions")
class SpecSchemaDefinitionsApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SchemaDefinitionsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        """
        Get system JSON Schema definitions specification
        Used for frontend component type mapping
        """
        try:
            schema_manager = SchemaManager()
            schema_definitions = schema_manager.get_all_schema_definitions()
            return schema_definitions, 200
        except Exception:
            logger.exception("Failed to get schema definitions from local registry")
            # Return empty array as fallback
            return [], 200

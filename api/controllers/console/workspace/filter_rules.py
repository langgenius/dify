"""
Filter Rules Management API

Provides endpoints for managing RAG filter rules (entities and attributes).
"""

from flask_login import current_user
from flask_restx import Resource, fields, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import api, console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import login_required
from services.filter_rule_service import FilterRulesData, FilterRuleService

# API Models
entity_model = api.model(
    "FilterEntity",
    {
        "name": fields.String(required=True, description="Entity or attribute name"),
        "attribute_type": fields.String(required=False, description="Attribute type (empty for base entities)"),
    },
)

filter_rules_response_model = api.model(
    "FilterRulesResponse",
    {
        "entities": fields.List(fields.Nested(entity_model), description="Base entities"),
        "attributes": fields.List(fields.Nested(entity_model), description="Attributes"),
    },
)

filter_rules_update_model = api.model(
    "FilterRulesUpdate",
    {
        "entities": fields.List(fields.Nested(entity_model), required=True, description="Base entities"),
        "attributes": fields.List(fields.Nested(entity_model), required=True, description="Attributes"),
    },
)

entity_create_model = api.model(
    "FilterEntityCreate",
    {
        "name": fields.String(required=True, description="Entity or attribute name"),
        "attribute_type": fields.String(required=False, description="Attribute type (empty for base entities)"),
    },
)

entity_update_model = api.model(
    "FilterEntityUpdate",
    {
        "old_name": fields.String(required=True, description="Current entity name"),
        "new_name": fields.String(required=True, description="New entity name"),
        "attribute_type": fields.String(required=False, description="Attribute type"),
    },
)

entity_delete_model = api.model(
    "FilterEntityDelete", {"name": fields.String(required=True, description="Entity or attribute name to delete")}
)


@console_ns.route("/workspaces/current/filter-rules")
class FilterRulesApi(Resource):
    @api.doc("get_filter_rules")
    @api.doc(description="Get all filter rules (entities and attributes)")
    @api.response(200, "Success", filter_rules_response_model)
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        """Get all filter rules"""
        rules_data = FilterRuleService.get_all_rules()
        return rules_data.to_dict()

    @api.doc("update_filter_rules")
    @api.doc(description="Batch update filter rules (requires admin/owner permission)")
    @api.expect(filter_rules_update_model)
    @api.response(200, "Filter rules updated successfully", filter_rules_response_model)
    @api.response(403, "Forbidden - Admin/Owner permission required")
    @api.response(400, "Invalid request")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        """Batch update filter rules (admin/owner only)"""
        # Check permissions
        if not current_user.is_admin_or_owner:
            raise Forbidden("Only workspace admin or owner can update filter rules")

        parser = reqparse.RequestParser()
        parser.add_argument("entities", type=list, required=True, location="json")
        parser.add_argument("attributes", type=list, required=True, location="json")
        args = parser.parse_args()

        try:
            # Create FilterRulesData from request
            rules_data = FilterRulesData.from_dict({"entities": args["entities"], "attributes": args["attributes"]})

            # Update rules
            success = FilterRuleService.update_rules(rules_data)

            if not success:
                return {"message": "Failed to update filter rules"}, 400

            # Return updated rules
            updated_rules = FilterRuleService.get_all_rules()
            return updated_rules.to_dict(), 200

        except Exception as e:
            return {"message": f"Failed to update filter rules: {str(e)}"}, 400


@console_ns.route("/workspaces/current/filter-rules/entity")
class FilterRuleEntityApi(Resource):
    @api.doc("create_filter_entity")
    @api.doc(description="Add a new entity or attribute (requires admin/owner permission)")
    @api.expect(entity_create_model)
    @api.response(201, "Entity created successfully")
    @api.response(403, "Forbidden - Admin/Owner permission required")
    @api.response(400, "Invalid request or entity already exists")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        """Add a new entity or attribute (admin/owner only)"""
        # Check permissions
        if not current_user.is_admin_or_owner:
            raise Forbidden("Only workspace admin or owner can add filter entities")

        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=True, location="json")
        parser.add_argument("attribute_type", type=str, required=False, location="json")
        args = parser.parse_args()

        name = args["name"].strip()
        attribute_type = (args.get("attribute_type") or "").strip() or None

        # Validate
        if not FilterRuleService.validate_entity_name(name):
            return {"message": "Invalid entity name"}, 400

        # Add entity
        success = FilterRuleService.add_entity(name=name, attribute_type=attribute_type)

        if not success:
            return {"message": "Failed to add entity (may already exist)"}, 400

        return {"message": "Entity added successfully", "entity": {"name": name, "attribute_type": attribute_type}}, 201

    @api.doc("update_filter_entity")
    @api.doc(description="Update an existing entity or attribute (requires admin/owner permission)")
    @api.expect(entity_update_model)
    @api.response(200, "Entity updated successfully")
    @api.response(403, "Forbidden - Admin/Owner permission required")
    @api.response(400, "Invalid request or entity not found")
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self):
        """Update an existing entity or attribute (admin/owner only)"""
        # Check permissions
        if not current_user.is_admin_or_owner:
            raise Forbidden("Only workspace admin or owner can update filter entities")

        parser = reqparse.RequestParser()
        parser.add_argument("old_name", type=str, required=True, location="json")
        parser.add_argument("new_name", type=str, required=True, location="json")
        parser.add_argument("attribute_type", type=str, required=False, location="json")
        args = parser.parse_args()

        old_name = args["old_name"].strip()
        new_name = args["new_name"].strip()
        attribute_type = (args.get("attribute_type") or "").strip() or None

        # Validate
        if not FilterRuleService.validate_entity_name(new_name):
            return {"message": "Invalid entity name"}, 400

        # Update entity
        success = FilterRuleService.update_entity(old_name=old_name, new_name=new_name, attribute_type=attribute_type)

        if not success:
            return {"message": "Failed to update entity (may not exist)"}, 400

        return {"message": "Entity updated successfully"}, 200

    @api.doc("delete_filter_entity")
    @api.doc(description="Delete an entity or attribute (requires admin/owner permission)")
    @api.expect(entity_delete_model)
    @api.response(200, "Entity deleted successfully")
    @api.response(403, "Forbidden - Admin/Owner permission required")
    @api.response(400, "Invalid request or entity not found")
    @setup_required
    @login_required
    @account_initialization_required
    def delete(self):
        """Delete an entity or attribute (admin/owner only)"""
        # Check permissions
        if not current_user.is_admin_or_owner:
            raise Forbidden("Only workspace admin or owner can delete filter entities")

        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=True, location="json")
        args = parser.parse_args()

        name = args["name"].strip()

        # Delete entity
        success = FilterRuleService.delete_entity(name=name)

        if not success:
            return {"message": "Failed to delete entity (may not exist)"}, 400

        return {"message": "Entity deleted successfully"}, 200


# Register routes
api.add_resource(FilterRulesApi, "/workspaces/current/filter-rules")
api.add_resource(FilterRuleEntityApi, "/workspaces/current/filter-rules/entity")


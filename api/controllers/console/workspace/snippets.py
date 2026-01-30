import logging

from flask import request
from flask_restx import Resource, marshal, marshal_with
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.snippets.payloads import (
    CreateSnippetPayload,
    SnippetListQuery,
    UpdateSnippetPayload,
)
from controllers.console.wraps import (
    account_initialization_required,
    edit_permission_required,
    setup_required,
)
from extensions.ext_database import db
from fields.snippet_fields import snippet_fields, snippet_list_fields, snippet_pagination_fields
from libs.login import current_account_with_tenant, login_required
from models.snippet import SnippetType
from services.snippet_service import SnippetService

logger = logging.getLogger(__name__)

# Register Pydantic models with Swagger
register_schema_models(
    console_ns,
    SnippetListQuery,
    CreateSnippetPayload,
    UpdateSnippetPayload,
)

# Create namespace models for marshaling
snippet_model = console_ns.model("Snippet", snippet_fields)
snippet_list_model = console_ns.model("SnippetList", snippet_list_fields)
snippet_pagination_model = console_ns.model("SnippetPagination", snippet_pagination_fields)


@console_ns.route("/workspaces/current/customized-snippets")
class CustomizedSnippetsApi(Resource):
    @console_ns.doc("list_customized_snippets")
    @console_ns.expect(console_ns.models.get(SnippetListQuery.__name__))
    @console_ns.response(200, "Snippets retrieved successfully", snippet_pagination_model)
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        """List customized snippets with pagination and search."""
        _, current_tenant_id = current_account_with_tenant()

        query_params = request.args.to_dict()
        query = SnippetListQuery.model_validate(query_params)

        snippets, total, has_more = SnippetService.get_snippets(
            tenant_id=current_tenant_id,
            page=query.page,
            limit=query.limit,
            keyword=query.keyword,
        )

        return {
            "data": marshal(snippets, snippet_list_fields),
            "page": query.page,
            "limit": query.limit,
            "total": total,
            "has_more": has_more,
        }, 200

    @console_ns.doc("create_customized_snippet")
    @console_ns.expect(console_ns.models.get(CreateSnippetPayload.__name__))
    @console_ns.response(201, "Snippet created successfully", snippet_model)
    @console_ns.response(400, "Invalid request or name already exists")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self):
        """Create a new customized snippet."""
        current_user, current_tenant_id = current_account_with_tenant()

        payload = CreateSnippetPayload.model_validate(console_ns.payload or {})

        try:
            snippet_type = SnippetType(payload.type)
        except ValueError:
            snippet_type = SnippetType.NODE

        try:
            snippet = SnippetService.create_snippet(
                tenant_id=current_tenant_id,
                name=payload.name,
                description=payload.description,
                snippet_type=snippet_type,
                icon_info=payload.icon_info.model_dump() if payload.icon_info else None,
                graph=payload.graph,
                input_fields=[f.model_dump() for f in payload.input_fields] if payload.input_fields else None,
                account=current_user,
            )
        except ValueError as e:
            return {"message": str(e)}, 400

        return marshal(snippet, snippet_fields), 201


@console_ns.route("/workspaces/current/customized-snippets/<uuid:snippet_id>")
class CustomizedSnippetDetailApi(Resource):
    @console_ns.doc("get_customized_snippet")
    @console_ns.response(200, "Snippet retrieved successfully", snippet_model)
    @console_ns.response(404, "Snippet not found")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, snippet_id: str):
        """Get customized snippet details."""
        _, current_tenant_id = current_account_with_tenant()

        snippet = SnippetService.get_snippet_by_id(
            snippet_id=str(snippet_id),
            tenant_id=current_tenant_id,
        )

        if not snippet:
            raise NotFound("Snippet not found")

        return marshal(snippet, snippet_fields), 200

    @console_ns.doc("update_customized_snippet")
    @console_ns.expect(console_ns.models.get(UpdateSnippetPayload.__name__))
    @console_ns.response(200, "Snippet updated successfully", snippet_model)
    @console_ns.response(400, "Invalid request or name already exists")
    @console_ns.response(404, "Snippet not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def patch(self, snippet_id: str):
        """Update customized snippet."""
        current_user, current_tenant_id = current_account_with_tenant()

        snippet = SnippetService.get_snippet_by_id(
            snippet_id=str(snippet_id),
            tenant_id=current_tenant_id,
        )

        if not snippet:
            raise NotFound("Snippet not found")

        payload = UpdateSnippetPayload.model_validate(console_ns.payload or {})
        update_data = payload.model_dump(exclude_unset=True)

        if "icon_info" in update_data and update_data["icon_info"] is not None:
            update_data["icon_info"] = payload.icon_info.model_dump() if payload.icon_info else None

        if not update_data:
            return {"message": "No valid fields to update"}, 400

        try:
            with Session(db.engine, expire_on_commit=False) as session:
                snippet = session.merge(snippet)
                snippet = SnippetService.update_snippet(
                    session=session,
                    snippet=snippet,
                    account_id=current_user.id,
                    data=update_data,
                )
                session.commit()
        except ValueError as e:
            return {"message": str(e)}, 400

        return marshal(snippet, snippet_fields), 200

    @console_ns.doc("delete_customized_snippet")
    @console_ns.response(204, "Snippet deleted successfully")
    @console_ns.response(404, "Snippet not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def delete(self, snippet_id: str):
        """Delete customized snippet."""
        _, current_tenant_id = current_account_with_tenant()

        snippet = SnippetService.get_snippet_by_id(
            snippet_id=str(snippet_id),
            tenant_id=current_tenant_id,
        )

        if not snippet:
            raise NotFound("Snippet not found")

        with Session(db.engine) as session:
            snippet = session.merge(snippet)
            SnippetService.delete_snippet(
                session=session,
                snippet=snippet,
            )
            session.commit()

        return "", 204

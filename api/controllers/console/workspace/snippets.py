import logging
import re
from datetime import datetime
from typing import Any
from urllib.parse import quote

from flask import Response, request
from flask_restx import Resource
from pydantic import Field as PydanticField
from pydantic import field_validator
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.datastructures import MultiDict
from werkzeug.exceptions import NotFound

from controllers.common.fields import TextFileResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.snippets.payloads import (
    CreateSnippetPayload,
    IncludeSecretQuery,
    SnippetImportPayload,
    SnippetListQuery,
    UpdateSnippetPayload,
)
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.plugin.entities.plugin import PluginDependency
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import dump_response, to_timestamp
from libs.login import login_required
from models import Account
from models.snippet import SnippetType
from services.snippet_dsl_service import ImportStatus, SnippetDslService
from services.snippet_service import SnippetService

logger = logging.getLogger(__name__)
_TAG_IDS_BRACKET_PATTERN = re.compile(r"^tag_ids\[(\d+)\]$")
_CREATOR_IDS_BRACKET_PATTERN = re.compile(r"^creator_ids\[(\d+)\]$")


class SnippetImportResponse(ResponseModel):
    id: str
    status: ImportStatus
    snippet_id: str | None
    current_dsl_version: str
    imported_dsl_version: str
    error: str


class SnippetDependencyCheckResponse(ResponseModel):
    leaked_dependencies: list[PluginDependency]


class SnippetUseCountResponse(ResponseModel):
    result: str
    use_count: int


class SnippetTagResponse(ResponseModel):
    id: str
    name: str
    type: str


class SnippetAccountResponse(ResponseModel):
    id: str
    name: str
    email: str


class SnippetListItemResponse(ResponseModel):
    id: str
    name: str
    description: str | None
    type: SnippetType
    version: int
    use_count: int
    is_published: bool
    icon_info: dict[str, Any] | None
    tags: list[SnippetTagResponse]
    created_by: str | None
    author_name: str | None
    created_at: int
    updated_by: str | None
    updated_at: int

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int:
        timestamp = to_timestamp(value)
        if timestamp is None:
            raise ValueError("timestamp is required")
        return timestamp


class SnippetResponse(ResponseModel):
    id: str
    name: str
    description: str | None
    type: SnippetType
    version: int
    use_count: int
    is_published: bool
    icon_info: dict[str, Any] | None
    graph: dict[str, Any] = PydanticField(validation_alias="graph_dict")
    input_fields: list[dict[str, Any]] = PydanticField(validation_alias="input_fields_list")
    tags: list[SnippetTagResponse]
    created_by: SnippetAccountResponse | None = PydanticField(validation_alias="created_by_account")
    created_at: int
    updated_by: SnippetAccountResponse | None = PydanticField(validation_alias="updated_by_account")
    updated_at: int

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int:
        timestamp = to_timestamp(value)
        if timestamp is None:
            raise ValueError("timestamp is required")
        return timestamp


class SnippetPaginationResponse(ResponseModel):
    data: list[SnippetListItemResponse]
    page: int
    limit: int
    total: int
    has_more: bool


def _snippet_service() -> SnippetService:
    return SnippetService(sessionmaker(bind=db.engine, expire_on_commit=False))


def _normalize_snippet_list_query_args(query_args: MultiDict[str, str]) -> dict[str, str | list[str]]:
    normalized: dict[str, str | list[str]] = {}
    indexed_tag_ids: list[tuple[int, str]] = []
    indexed_creator_ids: list[tuple[int, str]] = []

    for key in query_args:
        match = _TAG_IDS_BRACKET_PATTERN.fullmatch(key)
        if match:
            indexed_tag_ids.extend((int(match.group(1)), value) for value in query_args.getlist(key))
            continue

        match = _CREATOR_IDS_BRACKET_PATTERN.fullmatch(key)
        if match:
            indexed_creator_ids.extend((int(match.group(1)), value) for value in query_args.getlist(key))
            continue

        value = query_args.get(key)
        if value is not None:
            normalized[key] = value

    if indexed_tag_ids:
        normalized["tag_ids"] = [value for _, value in sorted(indexed_tag_ids)]
    if indexed_creator_ids:
        normalized["creators"] = [value for _, value in sorted(indexed_creator_ids)]

    return normalized


# Register Pydantic models with Swagger
register_schema_models(
    console_ns,
    SnippetListQuery,
    CreateSnippetPayload,
    UpdateSnippetPayload,
    SnippetImportPayload,
    IncludeSecretQuery,
)
register_response_schema_models(
    console_ns,
    TextFileResponse,
    SnippetImportResponse,
    SnippetDependencyCheckResponse,
    SnippetUseCountResponse,
    SnippetListItemResponse,
    SnippetResponse,
    SnippetPaginationResponse,
)


@console_ns.route("/workspaces/current/customized-snippets")
class CustomizedSnippetsApi(Resource):
    @console_ns.doc("list_customized_snippets")
    @console_ns.doc(params=query_params_from_model(SnippetListQuery))
    @console_ns.response(200, "Snippets retrieved successfully", console_ns.models[SnippetPaginationResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str):
        """List customized snippets with pagination and search."""
        query = SnippetListQuery.model_validate(_normalize_snippet_list_query_args(request.args))

        snippet_service = _snippet_service()
        snippets, total, has_more = snippet_service.get_snippets(
            tenant_id=current_tenant_id,
            session=db.session,
            page=query.page,
            limit=query.limit,
            keyword=query.keyword,
            is_published=query.is_published,
            creators=query.creators,
            tag_ids=query.tag_ids,
        )

        return dump_response(
            SnippetPaginationResponse,
            {
                "data": snippets,
                "page": query.page,
                "limit": query.limit,
                "total": total,
                "has_more": has_more,
            },
        ), 200

    @console_ns.doc("create_customized_snippet")
    @console_ns.expect(console_ns.models.get(CreateSnippetPayload.__name__))
    @console_ns.response(201, "Snippet created successfully", console_ns.models[SnippetResponse.__name__])
    @console_ns.response(400, "Invalid request")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.SNIPPETS_CREATE_AND_MODIFY, resource_required=False
    )
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account):
        """Create a new customized snippet."""
        payload = CreateSnippetPayload.model_validate(console_ns.payload or {})

        try:
            snippet_type = SnippetType(payload.type)
        except ValueError:
            snippet_type = SnippetType.NODE

        try:
            if payload.graph is not None:
                SnippetService.validate_snippet_graph_forbidden_nodes(payload.graph)

            snippet_service = _snippet_service()
            snippet = snippet_service.create_snippet(
                tenant_id=current_tenant_id,
                name=payload.name,
                description=payload.description,
                snippet_type=snippet_type,
                icon_info=payload.icon_info.model_dump() if payload.icon_info else None,
                input_fields=[f.model_dump() for f in payload.input_fields] if payload.input_fields else None,
                account=current_user,
            )
        except ValueError as e:
            return {"message": str(e)}, 400

        return dump_response(SnippetResponse, snippet), 201


@console_ns.route("/workspaces/current/customized-snippets/<uuid:snippet_id>")
class CustomizedSnippetDetailApi(Resource):
    @console_ns.doc("get_customized_snippet")
    @console_ns.response(200, "Snippet retrieved successfully", console_ns.models[SnippetResponse.__name__])
    @console_ns.response(404, "Snippet not found")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, snippet_id: str):
        """Get customized snippet details."""
        snippet_service = _snippet_service()
        snippet = snippet_service.get_snippet_by_id(
            snippet_id=str(snippet_id),
            tenant_id=current_tenant_id,
        )

        if not snippet:
            raise NotFound("Snippet not found")

        return dump_response(SnippetResponse, snippet), 200

    @console_ns.doc("update_customized_snippet")
    @console_ns.expect(console_ns.models.get(UpdateSnippetPayload.__name__))
    @console_ns.response(200, "Snippet updated successfully", console_ns.models[SnippetResponse.__name__])
    @console_ns.response(400, "Invalid request")
    @console_ns.response(404, "Snippet not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.SNIPPETS_CREATE_AND_MODIFY, resource_required=False
    )
    @with_current_user
    @with_current_tenant_id
    def patch(self, current_tenant_id: str, current_user: Account, snippet_id: str):
        """Update customized snippet."""
        snippet_service = _snippet_service()
        snippet = snippet_service.get_snippet_by_id(
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

        return dump_response(SnippetResponse, snippet), 200

    @console_ns.doc("delete_customized_snippet")
    @console_ns.response(204, "Snippet deleted successfully")
    @console_ns.response(404, "Snippet not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.SNIPPETS_MANAGE, resource_required=False)
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, snippet_id: str):
        """Delete customized snippet."""
        snippet_service = _snippet_service()
        snippet = snippet_service.get_snippet_by_id(
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


@console_ns.route("/workspaces/current/customized-snippets/<uuid:snippet_id>/export")
class CustomizedSnippetExportApi(Resource):
    @console_ns.doc("export_customized_snippet")
    @console_ns.doc(description="Export snippet configuration as DSL")
    @console_ns.doc(params={"snippet_id": "Snippet ID to export"})
    @console_ns.doc(params=query_params_from_model(IncludeSecretQuery))
    @console_ns.response(200, "Snippet exported successfully", console_ns.models[TextFileResponse.__name__])
    @console_ns.response(404, "Snippet not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.SNIPPETS_CREATE_AND_MODIFY, resource_required=False
    )
    @with_current_tenant_id
    def get(self, current_tenant_id: str, snippet_id: str):
        """Export snippet as DSL."""
        snippet_service = _snippet_service()
        snippet = snippet_service.get_snippet_by_id(
            snippet_id=str(snippet_id),
            tenant_id=current_tenant_id,
        )

        if not snippet:
            raise NotFound("Snippet not found")

        # Get include_secret parameter
        query = IncludeSecretQuery.model_validate(request.args.to_dict())

        with Session(db.engine) as session:
            export_service = SnippetDslService(session)
            result = export_service.export_snippet_dsl(snippet=snippet, include_secret=query.include_secret == "true")

        # Set filename with .snippet extension
        filename = f"{snippet.name}.snippet"
        encoded_filename = quote(filename)

        response = Response(
            result,
            mimetype="application/x-yaml",
        )
        response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_filename}"
        response.headers["Content-Type"] = "application/x-yaml"

        return response


@console_ns.route("/workspaces/current/customized-snippets/imports")
class CustomizedSnippetImportApi(Resource):
    @console_ns.doc("import_customized_snippet")
    @console_ns.doc(description="Import snippet from DSL")
    @console_ns.expect(console_ns.models.get(SnippetImportPayload.__name__))
    @console_ns.response(200, "Snippet imported successfully", console_ns.models[SnippetImportResponse.__name__])
    @console_ns.response(202, "Import pending confirmation", console_ns.models[SnippetImportResponse.__name__])
    @console_ns.response(400, "Import failed")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.SNIPPETS_CREATE_AND_MODIFY, resource_required=False
    )
    @with_current_user
    def post(self, current_user: Account):
        """Import snippet from DSL."""
        payload = SnippetImportPayload.model_validate(console_ns.payload or {})

        with Session(db.engine) as session:
            import_service = SnippetDslService(session)
            result = import_service.import_snippet(
                account=current_user,
                import_mode=payload.mode,
                yaml_content=payload.yaml_content,
                yaml_url=payload.yaml_url,
                snippet_id=payload.snippet_id,
                name=payload.name,
                description=payload.description,
            )
            session.commit()

        # Return appropriate status code based on result
        status = result.status
        if status == ImportStatus.FAILED:
            return dump_response(SnippetImportResponse, result), 400
        elif status == ImportStatus.PENDING:
            return dump_response(SnippetImportResponse, result), 202
        return dump_response(SnippetImportResponse, result), 200


@console_ns.route("/workspaces/current/customized-snippets/imports/<string:import_id>/confirm")
class CustomizedSnippetImportConfirmApi(Resource):
    @console_ns.doc("confirm_snippet_import")
    @console_ns.doc(description="Confirm a pending snippet import")
    @console_ns.doc(params={"import_id": "Import ID to confirm"})
    @console_ns.response(200, "Import confirmed successfully", console_ns.models[SnippetImportResponse.__name__])
    @console_ns.response(400, "Import failed")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.SNIPPETS_CREATE_AND_MODIFY, resource_required=False
    )
    @with_current_user
    def post(self, current_user: Account, import_id: str):
        """Confirm a pending snippet import."""
        with Session(db.engine) as session:
            import_service = SnippetDslService(session)
            result = import_service.confirm_import(import_id=import_id, account=current_user)
            session.commit()

        if result.status == ImportStatus.FAILED:
            return dump_response(SnippetImportResponse, result), 400
        return dump_response(SnippetImportResponse, result), 200


@console_ns.route("/workspaces/current/customized-snippets/<uuid:snippet_id>/check-dependencies")
class CustomizedSnippetCheckDependenciesApi(Resource):
    @console_ns.doc("check_snippet_dependencies")
    @console_ns.doc(description="Check dependencies for a snippet")
    @console_ns.doc(params={"snippet_id": "Snippet ID"})
    @console_ns.response(
        200,
        "Dependencies checked successfully",
        console_ns.models[SnippetDependencyCheckResponse.__name__],
    )
    @console_ns.response(404, "Snippet not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(
        RBACResourceScope.WORKSPACE, RBACPermission.SNIPPETS_CREATE_AND_MODIFY, resource_required=False
    )
    @with_current_tenant_id
    def get(self, current_tenant_id: str, snippet_id: str):
        """Check dependencies for a snippet."""
        snippet_service = _snippet_service()
        snippet = snippet_service.get_snippet_by_id(
            snippet_id=str(snippet_id),
            tenant_id=current_tenant_id,
        )

        if not snippet:
            raise NotFound("Snippet not found")

        with Session(db.engine) as session:
            import_service = SnippetDslService(session)
            result = import_service.check_dependencies(snippet=snippet)

        return dump_response(SnippetDependencyCheckResponse, result), 200


@console_ns.route("/workspaces/current/customized-snippets/<uuid:snippet_id>/use-count/increment")
class CustomizedSnippetUseCountIncrementApi(Resource):
    @console_ns.doc("increment_snippet_use_count")
    @console_ns.doc(description="Increment snippet use count by 1")
    @console_ns.doc(params={"snippet_id": "Snippet ID"})
    @console_ns.response(200, "Use count incremented successfully", console_ns.models[SnippetUseCountResponse.__name__])
    @console_ns.response(404, "Snippet not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str, snippet_id: str):
        """Increment snippet use count when it is inserted into a workflow."""
        snippet_service = _snippet_service()
        snippet = snippet_service.get_snippet_by_id(
            snippet_id=str(snippet_id),
            tenant_id=current_tenant_id,
        )

        if not snippet:
            raise NotFound("Snippet not found")

        with Session(db.engine) as session:
            snippet = session.merge(snippet)
            SnippetService.increment_use_count(session=session, snippet=snippet)
            session.commit()
            session.refresh(snippet)

        return {"result": "success", "use_count": snippet.use_count}, 200

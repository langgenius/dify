import logging
from urllib.parse import quote
from uuid import UUID

from flask import Response, request
from flask_restx import Resource
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.common.fields import TextFileResponse
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.app.wraps import with_session
from controllers.console.snippets.payloads import (
    CreateSnippetPayload,
    SnippetExportQuery,
    SnippetImportPayload,
    SnippetListQuery,
    UpdateSnippetPayload,
)
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    model_validate,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.db.session_factory import session_factory
from core.plugin.entities.plugin import PluginDependency
from fields.base import ResponseModel
from fields.snippet_fields import SnippetListItemResponse, SnippetPaginationResponse, SnippetResponse
from libs.helper import dump_response
from libs.login import login_required
from models import Account, Tag, TagBinding
from models.snippet import CustomizedSnippet, SnippetType
from models.workflow import Workflow
from services.entities.dsl_entities import DslImportWarning
from services.snippet_dsl_service import ImportStatus, SnippetDslService
from services.snippet_service import SnippetService

logger = logging.getLogger(__name__)


class SnippetImportResponse(ResponseModel):
    id: str
    status: ImportStatus
    snippet_id: str | None
    current_dsl_version: str
    imported_dsl_version: str
    error: str
    warnings: list[DslImportWarning]


class SnippetDependencyCheckResponse(ResponseModel):
    leaked_dependencies: list[PluginDependency]


class SnippetUseCountResponse(ResponseModel):
    result: str
    use_count: int


def _snippet_service(session: Session | None = None) -> SnippetService:
    if session is not None:
        return SnippetService(session=session)
    return SnippetService(session_factory.get_session_maker())


class _SnippetResponseSource:
    """Expose snippet response properties through the controller-owned session."""

    def __init__(self, snippet: CustomizedSnippet, *, session: Session) -> None:
        self._snippet = snippet
        self._session = session

    def __getattr__(self, name: str) -> object:
        return getattr(self._snippet, name)  # guard-ignore: no-new-getattr -- delegates mapped snippet fields

    @property
    def graph_dict(self) -> dict:
        if not self._snippet.workflow_id:
            return {}
        workflow = self._session.get(Workflow, self._snippet.workflow_id)
        return dict(workflow.graph_dict) if workflow else {}

    @property
    def tags(self) -> list[Tag]:
        return list(
            self._session.scalars(
                select(Tag)
                .join(TagBinding, Tag.id == TagBinding.tag_id)
                .where(
                    TagBinding.target_id == self._snippet.id,
                    TagBinding.tenant_id == self._snippet.tenant_id,
                    Tag.tenant_id == self._snippet.tenant_id,
                    Tag.type == "snippet",
                )
            )
        )

    @property
    def created_by_account(self) -> Account | None:
        return self._session.get(Account, self._snippet.created_by) if self._snippet.created_by else None

    @property
    def author_name(self) -> str | None:
        account = self.created_by_account
        return account.name if account else None

    @property
    def updated_by_account(self) -> Account | None:
        return self._session.get(Account, self._snippet.updated_by) if self._snippet.updated_by else None


def _snippet_list_query_from_request() -> SnippetListQuery:
    query_data: dict[str, str | list[str]] = dict(request.args.to_dict())
    query_data["tag_ids"] = request.args.getlist("tag_ids")

    creator_ids = request.args.getlist("creators") or request.args.getlist("creator_ids")
    if creator_ids:
        query_data["creators"] = creator_ids

    return SnippetListQuery.model_validate(query_data)


# Register Pydantic models with Swagger
register_schema_models(
    console_ns,
    SnippetListQuery,
    CreateSnippetPayload,
    UpdateSnippetPayload,
    SnippetImportPayload,
    SnippetExportQuery,
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
    @with_session(write=False)
    def get(self, session: Session, current_tenant_id: str):
        """List customized snippets with pagination and search."""
        query = _snippet_list_query_from_request()

        snippet_service = _snippet_service(session)
        snippets, total, has_more = snippet_service.get_snippets(
            tenant_id=current_tenant_id,
            session=session,
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
                "data": [_SnippetResponseSource(snippet, session=session) for snippet in snippets],
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
    @with_session
    @model_validate(CreateSnippetPayload)
    def post(
        self,
        req_data: CreateSnippetPayload,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
    ):
        """Create a new customized snippet."""
        try:
            snippet_type = SnippetType(req_data.type)
        except ValueError:
            snippet_type = SnippetType.NODE

        try:
            if req_data.graph is not None:
                SnippetService.validate_snippet_graph_forbidden_nodes(req_data.graph)

            snippet_service = _snippet_service(session)
            snippet = snippet_service.create_snippet(
                tenant_id=current_tenant_id,
                name=req_data.name,
                description=req_data.description,
                snippet_type=snippet_type,
                icon_info=req_data.icon_info.model_dump() if req_data.icon_info else None,
                input_fields=[f.model_dump() for f in req_data.input_fields] if req_data.input_fields else None,
                account=current_user,
            )
        except ValueError as e:
            return {"message": str(e)}, 400

        return dump_response(SnippetResponse, _SnippetResponseSource(snippet, session=session)), 201


@console_ns.route("/workspaces/current/customized-snippets/<uuid:snippet_id>")
class CustomizedSnippetDetailApi(Resource):
    @console_ns.doc("get_customized_snippet")
    @console_ns.response(200, "Snippet retrieved successfully", console_ns.models[SnippetResponse.__name__])
    @console_ns.response(404, "Snippet not found")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    @with_session(write=False)
    def get(self, session: Session, current_tenant_id: str, snippet_id: UUID):
        """Get customized snippet details."""
        snippet_service = _snippet_service(session)
        snippet = snippet_service.get_snippet_by_id(
            snippet_id=str(snippet_id),
            tenant_id=current_tenant_id,
        )

        if not snippet:
            raise NotFound("Snippet not found")

        return dump_response(SnippetResponse, _SnippetResponseSource(snippet, session=session)), 200

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
    @with_session
    @model_validate(UpdateSnippetPayload)
    def patch(
        self,
        req_data: UpdateSnippetPayload,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        snippet_id: str,
    ):
        """Update customized snippet."""
        snippet_service = _snippet_service(session)
        snippet = snippet_service.get_snippet_by_id(
            snippet_id=snippet_id,
            tenant_id=current_tenant_id,
        )

        if not snippet:
            raise NotFound("Snippet not found")

        update_data = req_data.model_dump(exclude_unset=True)

        if "icon_info" in update_data and update_data["icon_info"] is not None:
            update_data["icon_info"] = req_data.icon_info.model_dump() if req_data.icon_info else None

        if not update_data:
            return {"message": "No valid fields to update"}, 400

        try:
            snippet = SnippetService.update_snippet(
                session=session,
                snippet=snippet,
                account_id=current_user.id,
                data=update_data,
            )
        except ValueError as e:
            session.rollback()  # guard-ignore: no-new-controller-sqlalchemy -- translated validation response
            return {"message": str(e)}, 400

        return dump_response(SnippetResponse, _SnippetResponseSource(snippet, session=session)), 200

    @console_ns.doc("delete_customized_snippet")
    @console_ns.response(204, "Snippet deleted successfully")
    @console_ns.response(404, "Snippet not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.SNIPPETS_MANAGE, resource_required=False)
    @with_current_user
    @with_current_tenant_id
    @with_session
    def delete(self, session: Session, current_tenant_id: str, current_user: Account, snippet_id: str):
        """Delete customized snippet."""
        snippet_service = _snippet_service(session)
        snippet = snippet_service.get_snippet_by_id(
            snippet_id=snippet_id,
            tenant_id=current_tenant_id,
        )

        if not snippet:
            raise NotFound("Snippet not found")

        SnippetService.delete_snippet(
            session=session,
            snippet=snippet,
            account_id=current_user.id,
        )

        return "", 204


@console_ns.route("/workspaces/current/customized-snippets/<uuid:snippet_id>/export")
class CustomizedSnippetExportApi(Resource):
    @console_ns.doc("export_customized_snippet")
    @console_ns.doc(description="Export snippet configuration as DSL")
    @console_ns.doc(params={"snippet_id": "Snippet ID to export"})
    @console_ns.doc(params=query_params_from_model(SnippetExportQuery))
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
    @with_session(write=False)
    def get(self, session: Session, current_tenant_id: str, snippet_id: str):
        """Export snippet as DSL."""
        snippet_service = _snippet_service(session)
        snippet = snippet_service.get_snippet_by_id(
            snippet_id=snippet_id,
            tenant_id=current_tenant_id,
        )

        if not snippet:
            raise NotFound("Snippet not found")

        # Get include_secret parameter
        query = SnippetExportQuery.model_validate(request.args.to_dict())

        export_service = SnippetDslService(session)
        try:
            result = export_service.export_snippet_dsl(
                snippet=snippet,
                include_secret=query.include_secret == "true",
                workflow_id=query.workflow_id,
            )
        except ValueError as exc:
            raise NotFound(str(exc)) from exc

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
    @with_session
    @model_validate(SnippetImportPayload)
    def post(self, req_data: SnippetImportPayload, session: Session, current_user: Account):
        """Import snippet from DSL."""
        import_service = SnippetDslService(session)
        result = import_service.import_snippet(
            account=current_user,
            import_mode=req_data.mode,
            yaml_content=req_data.yaml_content,
            yaml_url=req_data.yaml_url,
            snippet_id=req_data.snippet_id,
            name=req_data.name,
            description=req_data.description,
        )

        # Return appropriate status code based on result
        status = result.status
        if status == ImportStatus.FAILED:
            return result.model_dump(mode="json"), 400
        elif status == ImportStatus.PENDING:
            return result.model_dump(mode="json"), 202
        return result.model_dump(mode="json"), 200


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
    @with_session
    def post(self, session: Session, current_user: Account, import_id: str):
        """Confirm a pending snippet import."""
        import_service = SnippetDslService(session)
        result = import_service.confirm_import(import_id=import_id, account=current_user)

        if result.status == ImportStatus.FAILED:
            return result.model_dump(mode="json"), 400
        return result.model_dump(mode="json"), 200


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
    @with_session(write=False)
    def get(self, session: Session, current_tenant_id: str, snippet_id: str):
        """Check dependencies for a snippet."""
        snippet_service = _snippet_service(session)
        snippet = snippet_service.get_snippet_by_id(
            snippet_id=snippet_id,
            tenant_id=current_tenant_id,
        )

        if not snippet:
            raise NotFound("Snippet not found")

        import_service = SnippetDslService(session)
        result = import_service.check_dependencies(snippet=snippet)

        return result.model_dump(mode="json"), 200


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
    @with_session
    def post(self, session: Session, current_tenant_id: str, snippet_id: str):
        """Increment snippet use count when it is inserted into a workflow."""
        snippet_service = _snippet_service(session)
        snippet = snippet_service.get_snippet_by_id(
            snippet_id=snippet_id,
            tenant_id=current_tenant_id,
        )

        if not snippet:
            raise NotFound("Snippet not found")

        SnippetService.increment_use_count(session=session, snippet=snippet)
        session.flush()

        return {"result": "success", "use_count": snippet.use_count}, 200

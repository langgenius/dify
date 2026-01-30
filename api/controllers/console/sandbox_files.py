from __future__ import annotations

from flask import request
from flask_restx import Resource, fields
from pydantic import BaseModel, Field

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import current_account_with_tenant, login_required
from services.sandbox.sandbox_file_service import SandboxFileService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class SandboxFileListQuery(BaseModel):
    path: str | None = Field(default=None, description="Workspace relative path")
    recursive: bool = Field(default=False, description="List recursively")


class SandboxFileDownloadRequest(BaseModel):
    path: str = Field(..., description="Workspace relative file path")


console_ns.schema_model(
    SandboxFileListQuery.__name__,
    SandboxFileListQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)
console_ns.schema_model(
    SandboxFileDownloadRequest.__name__,
    SandboxFileDownloadRequest.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


SANDBOX_FILE_NODE_FIELDS = {
    "path": fields.String,
    "is_dir": fields.Boolean,
    "size": fields.Raw,
    "mtime": fields.Raw,
    "extension": fields.String,
}


SANDBOX_FILE_DOWNLOAD_TICKET_FIELDS = {
    "download_url": fields.String,
    "expires_in": fields.Integer,
    "export_id": fields.String,
}


sandbox_file_node_model = console_ns.model("SandboxFileNode", SANDBOX_FILE_NODE_FIELDS)
sandbox_file_download_ticket_model = console_ns.model("SandboxFileDownloadTicket", SANDBOX_FILE_DOWNLOAD_TICKET_FIELDS)


@console_ns.route("/apps/<string:app_id>/sandbox/files")
class SandboxFilesApi(Resource):
    """List sandbox files for the current user.

    The sandbox_id is derived from the current user's ID, as each user has
    their own sandbox workspace per app.
    """

    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.expect(console_ns.models[SandboxFileListQuery.__name__])
    @console_ns.marshal_list_with(sandbox_file_node_model)
    def get(self, app_id: str):
        args = SandboxFileListQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore[arg-type]
        account, tenant_id = current_account_with_tenant()
        sandbox_id = account.id
        return [
            e.__dict__
            for e in SandboxFileService.list_files(
                tenant_id=tenant_id,
                app_id=app_id,
                sandbox_id=sandbox_id,
                path=args.path,
                recursive=args.recursive,
            )
        ]


@console_ns.route("/apps/<string:app_id>/sandbox/files/download")
class SandboxFileDownloadApi(Resource):
    """Download a sandbox file for the current user.

    The sandbox_id is derived from the current user's ID, as each user has
    their own sandbox workspace per app.
    """

    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.expect(console_ns.models[SandboxFileDownloadRequest.__name__])
    @console_ns.marshal_with(sandbox_file_download_ticket_model)
    def post(self, app_id: str):
        payload = SandboxFileDownloadRequest.model_validate(console_ns.payload or {})
        account, tenant_id = current_account_with_tenant()
        sandbox_id = account.id
        res = SandboxFileService.download_file(
            tenant_id=tenant_id, app_id=app_id, sandbox_id=sandbox_id, path=payload.path
        )
        return res.__dict__

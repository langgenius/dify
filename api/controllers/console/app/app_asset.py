from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import Forbidden

from controllers.console import console_ns
from controllers.console.app.error import (
    AppAssetFileRequiredError,
    AppAssetNodeNotFoundError,
    AppAssetPathConflictError,
)
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import current_account_with_tenant, login_required
from models import App
from models.model import AppMode
from services.app_asset_service import AppAssetService
from services.errors.app_asset import (
    AppAssetNodeNotFoundError as ServiceNodeNotFoundError,
)
from services.errors.app_asset import (
    AppAssetParentNotFoundError,
)
from services.errors.app_asset import (
    AppAssetPathConflictError as ServicePathConflictError,
)

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class CreateFolderPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    parent_id: str | None = None


class CreateFilePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    parent_id: str | None = None

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip() if isinstance(v, str) else v

    @field_validator("parent_id", mode="before")
    @classmethod
    def empty_to_none(cls, v: str | None) -> str | None:
        return v or None


class UpdateFileContentPayload(BaseModel):
    content: str


class RenameNodePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class MoveNodePayload(BaseModel):
    parent_id: str | None = None


class ReorderNodePayload(BaseModel):
    after_node_id: str | None = Field(default=None, description="Place after this node, None for first position")


def reg(cls: type[BaseModel]) -> None:
    console_ns.schema_model(cls.__name__, cls.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


reg(CreateFolderPayload)
reg(CreateFilePayload)
reg(UpdateFileContentPayload)
reg(RenameNodePayload)
reg(MoveNodePayload)
reg(ReorderNodePayload)


@console_ns.route("/apps/<string:app_id>/assets/tree")
class AppAssetTreeResource(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App):
        current_user, _ = current_account_with_tenant()
        tree = AppAssetService.get_asset_tree(app_model, current_user.id)
        return {"children": [view.model_dump() for view in tree.transform()]}


@console_ns.route("/apps/<string:app_id>/assets/folders")
class AppAssetFolderResource(Resource):
    @console_ns.expect(console_ns.models[CreateFolderPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App):
        current_user, _ = current_account_with_tenant()
        payload = CreateFolderPayload.model_validate(console_ns.payload or {})

        try:
            node = AppAssetService.create_folder(app_model, current_user.id, payload.name, payload.parent_id)
            return node.model_dump(), 201
        except AppAssetParentNotFoundError:
            raise AppAssetNodeNotFoundError()
        except ServicePathConflictError:
            raise AppAssetPathConflictError()


@console_ns.route("/apps/<string:app_id>/assets/files")
class AppAssetFileResource(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App):
        current_user, _ = current_account_with_tenant()

        file = request.files.get("file")
        if not file:
            raise AppAssetFileRequiredError()

        payload = CreateFilePayload.model_validate(request.form.to_dict())
        content = file.read()

        try:
            node = AppAssetService.create_file(app_model, current_user.id, payload.name, content, payload.parent_id)
            return node.model_dump(), 201
        except AppAssetParentNotFoundError:
            raise AppAssetNodeNotFoundError()
        except ServicePathConflictError:
            raise AppAssetPathConflictError()


@console_ns.route("/apps/<string:app_id>/assets/files/<string:node_id>")
class AppAssetFileDetailResource(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, node_id: str):
        current_user, _ = current_account_with_tenant()
        try:
            content = AppAssetService.get_file_content(app_model, current_user.id, node_id)
            return {"content": content.decode("utf-8", errors="replace")}
        except ServiceNodeNotFoundError:
            raise AppAssetNodeNotFoundError()

    @console_ns.expect(console_ns.models[UpdateFileContentPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def put(self, app_model: App, node_id: str):
        current_user, _ = current_account_with_tenant()

        file = request.files.get("file")
        if file:
            content = file.read()
        else:
            payload = UpdateFileContentPayload.model_validate(console_ns.payload or {})
            content = payload.content.encode("utf-8")

        try:
            node = AppAssetService.update_file_content(app_model, current_user.id, node_id, content)
            return node.model_dump()
        except ServiceNodeNotFoundError:
            raise AppAssetNodeNotFoundError()


@console_ns.route("/apps/<string:app_id>/assets/nodes/<string:node_id>")
class AppAssetNodeResource(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def delete(self, app_model: App, node_id: str):
        current_user, _ = current_account_with_tenant()
        try:
            AppAssetService.delete_node(app_model, current_user.id, node_id)
            return {"result": "success"}, 200
        except ServiceNodeNotFoundError:
            raise AppAssetNodeNotFoundError()


@console_ns.route("/apps/<string:app_id>/assets/nodes/<string:node_id>/rename")
class AppAssetNodeRenameResource(Resource):
    @console_ns.expect(console_ns.models[RenameNodePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App, node_id: str):
        current_user, _ = current_account_with_tenant()
        payload = RenameNodePayload.model_validate(console_ns.payload or {})

        try:
            node = AppAssetService.rename_node(app_model, current_user.id, node_id, payload.name)
            return node.model_dump()
        except ServiceNodeNotFoundError:
            raise AppAssetNodeNotFoundError()
        except ServicePathConflictError:
            raise AppAssetPathConflictError()


@console_ns.route("/apps/<string:app_id>/assets/nodes/<string:node_id>/move")
class AppAssetNodeMoveResource(Resource):
    @console_ns.expect(console_ns.models[MoveNodePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App, node_id: str):
        current_user, _ = current_account_with_tenant()
        payload = MoveNodePayload.model_validate(console_ns.payload or {})

        try:
            node = AppAssetService.move_node(app_model, current_user.id, node_id, payload.parent_id)
            return node.model_dump()
        except ServiceNodeNotFoundError:
            raise AppAssetNodeNotFoundError()
        except AppAssetParentNotFoundError:
            raise AppAssetNodeNotFoundError()
        except ServicePathConflictError:
            raise AppAssetPathConflictError()


@console_ns.route("/apps/<string:app_id>/assets/nodes/<string:node_id>/reorder")
class AppAssetNodeReorderResource(Resource):
    @console_ns.expect(console_ns.models[ReorderNodePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App, node_id: str):
        current_user, _ = current_account_with_tenant()
        payload = ReorderNodePayload.model_validate(console_ns.payload or {})

        try:
            node = AppAssetService.reorder_node(app_model, current_user.id, node_id, payload.after_node_id)
            return node.model_dump()
        except ServiceNodeNotFoundError:
            raise AppAssetNodeNotFoundError()


@console_ns.route("/apps/<string:app_id>/assets/publish")
class AppAssetPublishResource(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App):
        current_user, _ = current_account_with_tenant()
        published = AppAssetService.publish(app_model, current_user.id)
        return {
            "id": published.id,
            "version": published.version,
            "asset_tree": published.asset_tree.model_dump(),
        }, 201


@console_ns.route("/apps/<string:app_id>/assets/files/<string:node_id>/download-url")
class AppAssetFileDownloadUrlResource(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, node_id: str):
        current_user, _ = current_account_with_tenant()
        try:
            download_url = AppAssetService.get_file_download_url(app_model, current_user.id, node_id)
            return {"download_url": download_url}
        except ServiceNodeNotFoundError:
            raise AppAssetNodeNotFoundError()


@console_ns.route("/apps/<string:app_id>/assets/files/<string:node_id>/download")
class AppAssetFileDownloadResource(Resource):
    @setup_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, node_id: str):
        timestamp = request.args.get("timestamp", "")
        nonce = request.args.get("nonce", "")
        sign = request.args.get("sign", "")

        if not AppAssetService.verify_download_signature(
            app_id=app_model.id,
            node_id=node_id,
            timestamp=timestamp,
            nonce=nonce,
            sign=sign,
        ):
            raise Forbidden("Invalid or expired download link")

        try:
            content, filename = AppAssetService.get_file_for_download(app_model, node_id)
        except ServiceNodeNotFoundError:
            raise AppAssetNodeNotFoundError()

        return Response(
            content,
            mimetype="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

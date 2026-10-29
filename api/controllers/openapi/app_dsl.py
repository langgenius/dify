from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from http import HTTPStatus
from typing import BinaryIO, Final, cast
from uuid import UUID, uuid4

from flask import send_file
from flask_restx import Resource
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import BadRequest, NotFound

from configs import dify_config
from constants.oauth_bearer import Scope
from controllers.common.errors import ForbiddenError, NotFoundError
from controllers.common.fields import BinaryFileResponse
from controllers.common.rbac import RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._archive import FolderRejections, FolderUpload
from controllers.openapi._contract import Effect, Example, Kind, endpoint, op_of
from controllers.openapi._errors import (
    AppPackageInvalid,
    AppPackageTooLarge,
    DraftChanged,
    DraftNotFound,
    DslInvalid,
    ErrorDetail,
    VersionNotFound,
)
from controllers.openapi._models import (
    AppDslExportQuery,
    AppDslExportResponse,
    AppDslImportPayload,
    AppDslImportResponse,
    AppPackageExportQuery,
    AppPackageImportPayload,
    CheckDependenciesResponse,
    DslCheckPayload,
    DslCheckResponse,
    DslIssueRow,
    Hint,
)
from controllers.openapi._upload import UploadPart, UploadParts
from controllers.openapi.auth.requirements import (
    EDITOR_ROLES,
    account_app_guards,
    workspace_write_guards,
)
from controllers.openapi.plugins import PluginInstallApi
from core.plugin.entities.plugin import PluginDependencyType
from extensions.ext_application_services import application_services
from machinery.context import AppRequestContext, RequestContext
from services.agent.errors import InvalidRosterAgentPackageError, RosterAgentPackageTooLargeError
from services.app.console_service import ConsoleAppNotFoundError
from services.entities.app_entities import AppExportOptions
from services.entities.dsl_entities import DraftGuardedImportParams, Import, ImportMode, ImportStatus
from services.errors.app import (
    AppDiscoveryNotFoundError,
    DraftChangedError,
    IsDraftWorkflowError,
    WorkflowNotFoundError,
)
from services.errors.base import NoPermissionError
from services.workflow.dsl_import import (
    DslNotCheckableError,
    DslRefusedError,
    YamlUrlFetchError,
)
from services.workflow.graph_check import IssueSeverity
from services.workflow.graph_diff import current_draft_token

_DSL_READ_GUARDS: Final = account_app_guards(
    RBACPermission.APP_IMPORT_EXPORT_DSL, scope=Scope.APPS_READ, roles=EDITOR_ROLES
)
_PACKAGE_READ_GUARDS: Final = account_app_guards(
    RBACPermission.APP_IMPORT_EXPORT_DSL,
    scope=Scope.APPS_READ,
    roles=EDITOR_ROLES,
    agent_permission=RBACPermission.AGENT_IMPORT_EXPORT_DSL,
)
_DSL_WRITE_GUARDS: Final = workspace_write_guards(RBACPermission.APP_IMPORT_EXPORT_DSL, roles=EDITOR_ROLES)
_PACKAGE_UPLOAD: Final = FolderUpload(
    payload=AppPackageImportPayload,
    max_entries=lambda: dify_config.AGENT_PACKAGE_MAX_ENTRIES,
    max_bytes=lambda: dify_config.AGENT_PACKAGE_MAX_BYTES,
    rejections=FolderRejections("package folder", AppPackageInvalid, AppPackageTooLarge),
)


def _check_hint(context: RequestContext, app_id: str | None) -> Hint:
    return Hint(
        summary="See every problem, including warnings",
        op=op_of(AppDslCheckApi.post),
        input={"workspace_id": context.active_workspace_id, "yaml_content": None, "app_id": app_id},
    )


def _prepared_yaml(
    context: RequestContext, *, mode: ImportMode, source: str, app_id: str | None, draft_hash: str | None
) -> str:
    try:
        return application_services().apps.dsl_imports.prepare(
            context, mode=mode, source=source, app_id=app_id, draft_hash=draft_hash
        )
    except ConsoleAppNotFoundError as error:
        raise NotFound(str(error)) from error
    except DraftChangedError as error:
        raise DraftChanged() from error
    except DslRefusedError as error:
        raise DslInvalid(
            details=[ErrorDetail(type=i.code, loc=list(i.loc), msg=i.message) for i in error.issues],
            hints=[_check_hint(context, app_id)],
        ) from error


@contextmanager
def _package_source(package: UploadPart | UploadParts) -> Generator[BinaryIO]:
    """A file part is the package as sent; a folder is zipped into a temporary archive, closed on exit."""
    if isinstance(package, FileStorage):
        yield cast(BinaryIO, package.stream)
        return
    archive = _PACKAGE_UPLOAD.archive(package)
    try:
        yield archive.file
    finally:
        archive.file.close()


def _import_response(result: Import, *, workspace_id: str) -> AppDslImportResponse:
    hints: list[Hint] = []
    if result.status == ImportStatus.PENDING:
        hints.append(
            Hint(
                summary="Confirm the pending import",
                op=op_of(AppDslImportConfirmApi.post),
                input={"workspace_id": workspace_id, "import_id": result.id},
            )
        )
    return AppDslImportResponse(**result.model_dump(), hints=hints)


def _import_status(result: Import) -> HTTPStatus:
    match result.status:
        case ImportStatus.FAILED:
            return HTTPStatus.BAD_REQUEST
        case ImportStatus.PENDING:
            return HTTPStatus.ACCEPTED
        case _:
            return HTTPStatus.OK


@openapi_ns.route("/workspaces/<string:workspace_id>/apps/imports")
class AppDslImportApi(Resource):
    """Import a DSL YAML string into the specified workspace.

    Use ``mode=yaml-content`` with ``yaml_content`` for inline YAML, or
    ``mode=yaml-url`` with ``yaml_url`` for a remote URL.  Provide ``app_id``
    to overwrite an existing workflow or advanced-chat app; omit it to create
    a new app.

    Returns 202 when the DSL version requires an explicit confirmation step
    (major version mismatch).  Callers must then POST to the imports :confirm method.
    Returns 400 with the ``Import`` body when the import failed (an unreachable URL,
    unparsable DSL or a business error), 409 ``draft_changed`` when ``draft_hash`` no
    longer matches the draft, and 422 ``dsl_invalid`` when the graph has errors.
    """

    @endpoint(
        context="workspace",
        op="import.console_app.dsl",
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Import an app from DSL text or URL",
        examples=(
            Example(
                title="Import an app from inline YAML",
                input={"mode": "yaml-content", "yaml_content": "<yaml text of the app DSL>"},
            ),
            Example(
                title="Import an app from a URL",
                input={"mode": "yaml-url", "yaml_url": "https://example.com/apps/release-summary.yml"},
            ),
            Example(
                title="Overwrite an existing workflow app from YAML",
                input={"mode": "yaml-content", "yaml_content": "<yaml text of the app DSL>", "app_id": "<app_id>"},
            ),
        ),
        requirements=_DSL_WRITE_GUARDS,
        body=AppDslImportPayload,
        returns=(
            (HTTPStatus.OK, AppDslImportResponse, "Import completed"),
            (HTTPStatus.ACCEPTED, AppDslImportResponse, "Import pending confirmation"),
            (HTTPStatus.BAD_REQUEST, AppDslImportResponse, "Import failed"),
        ),
    )
    def post(self, ctx: RequestContext, workspace_id: str, *, body: AppDslImportPayload):
        try:
            yaml_content = _prepared_yaml(
                ctx, mode=ImportMode(body.mode), source=body.source, app_id=body.app_id, draft_hash=body.draft_hash
            )
        except YamlUrlFetchError as error:
            failed = Import(id=str(uuid4()), status=ImportStatus.FAILED, error=str(error))
            return _import_response(failed, workspace_id=workspace_id), HTTPStatus.BAD_REQUEST
        params = DraftGuardedImportParams.model_validate(
            body.model_dump() | {"mode": ImportMode.YAML_CONTENT, "yaml_content": yaml_content, "yaml_url": None}
        )
        try:
            result = application_services().apps.imports.import_app(ctx, params)
        except NoPermissionError as exc:
            raise ForbiddenError(str(exc)) from exc
        except DraftChangedError as exc:
            raise DraftChanged() from exc

        return _import_response(result, workspace_id=workspace_id), _import_status(result)


@openapi_ns.route("/workspaces/<string:workspace_id>/apps/packages")
class AppPackageImportApi(Resource):
    """Import an app from a ``.ifpkg`` package: one file, or the unpacked folder with one part per file.

    Provide ``app_id`` to overwrite an existing workflow or advanced-chat app; omit it to create a new app.
    Roster Agent nodes keep their links to the workspace's Agents. The root app's YAML goes through the
    same checks as ``import.console_app.dsl``: 409 ``draft_changed`` when ``draft_hash`` no longer matches
    the draft, 422 ``dsl_invalid`` when the graph has errors.

    Returns 202 when the DSL version requires an explicit confirmation step; confirm it with the imports
    :confirm method. Returns 400 ``app_package_invalid`` for a package that cannot be read, and 413 for one
    over this server's limits.
    """

    @endpoint(
        context="workspace",
        op="import.console_app.package",
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Import an app from a .ifpkg package or an unpacked package folder",
        examples=(
            Example(title="Import an app from a .ifpkg file", input={"package": "./app.ifpkg"}),
            Example(
                title="Overwrite an existing workflow app from an unpacked package folder",
                input={"package": "./app/", "app_id": "<app_id>", "draft_hash": "<draft_hash>"},
            ),
        ),
        requirements=(*_DSL_WRITE_GUARDS, _PACKAGE_UPLOAD.cap()),
        body=AppPackageImportPayload,
        returns=(
            (HTTPStatus.OK, AppDslImportResponse, "Import completed"),
            (HTTPStatus.ACCEPTED, AppDslImportResponse, "Import pending confirmation"),
            (HTTPStatus.BAD_REQUEST, AppDslImportResponse, "Import failed"),
        ),
    )
    def post(self, ctx: RequestContext, workspace_id: str, *, body: AppPackageImportPayload):
        params = DraftGuardedImportParams.model_validate(
            body.model_dump(exclude={"package"}) | {"mode": ImportMode.YAML_CONTENT}
        )
        with _package_source(body.package) as source:
            try:
                result = application_services().apps.console.import_app(
                    ctx,
                    params,
                    source=source,
                    preserve_agent_bindings=True,
                    prepare_dsl=lambda dsl: _prepared_yaml(
                        ctx, mode=ImportMode.YAML_CONTENT, source=dsl, app_id=body.app_id, draft_hash=body.draft_hash
                    ),
                )
            except InvalidRosterAgentPackageError as exc:
                raise AppPackageInvalid(exc.description) from exc
            except RosterAgentPackageTooLargeError as exc:
                raise AppPackageTooLarge(exc.description) from exc
            except NoPermissionError as exc:
                raise ForbiddenError(str(exc)) from exc
            except DraftChangedError as exc:
                raise DraftChanged() from exc
        return _import_response(result, workspace_id=workspace_id), _import_status(result)


@openapi_ns.route("/workspaces/<string:workspace_id>/apps/imports:check")
class AppDslCheckApi(Resource):
    """Check a DSL without importing it.

    Errors are what the import refuses; warnings (missing credentials or models) are what the release check refuses.
    Pass ``app_id`` to check against an existing app's mode, as an overwrite import would.
    """

    @endpoint(
        context="workspace",
        op="check.console_app.dsl",
        kind=Kind.OBJECT,
        effect=Effect.READ,
        summary="Check a DSL without importing it: every problem with its node and field",
        examples=(Example(title="Check a DSL (pipe the YAML)", input={"yaml_content": "<yaml text of the app DSL>"}),),
        requirements=_DSL_WRITE_GUARDS,
        body=DslCheckPayload,
        returns=(HTTPStatus.OK, DslCheckResponse, "Check result"),
    )
    def post(self, ctx: RequestContext, workspace_id: str, *, body: DslCheckPayload):
        try:
            issues = application_services().apps.dsl_imports.check(ctx, body.yaml_content, body.app_id)
        except DslNotCheckableError as error:
            raise BadRequest(str(error)) from error
        except ConsoleAppNotFoundError as error:
            raise NotFound(str(error)) from error
        response = DslCheckResponse(
            valid=not any(i.code.severity is IssueSeverity.ERROR for i in issues),
            issues=[DslIssueRow.of(i) for i in issues],
        )
        return response, HTTPStatus.OK


@openapi_ns.route("/workspaces/<string:workspace_id>/apps/imports/<string:import_id>:confirm")
class AppDslImportConfirmApi(Resource):
    """Confirm a pending DSL import identified by ``import_id``.

    Required only when the initial import returned 202 (major DSL version
    mismatch that requires explicit acknowledgement).  The pending state is
    stored in Redis for 10 minutes; this call retrieves it and completes the
    import under the given workspace.

    Returns 400 when the pending data has expired or the import fails, and 409 ``draft_changed``
    when the import carried a ``draft_hash`` the draft no longer matches.
    """

    @endpoint(
        context="workspace",
        op="confirm.console_app.dsl_import",
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Confirm a pending DSL import",
        examples=(Example(title="Confirm an import that is pending confirmation", input={"import_id": "<import_id>"}),),
        requirements=_DSL_WRITE_GUARDS,
        returns=((HTTPStatus.OK, Import, "Import confirmed"), (HTTPStatus.BAD_REQUEST, Import, "Import failed")),
    )
    def post(self, ctx: RequestContext, workspace_id: str, import_id: str):
        try:
            result = application_services().apps.imports.confirm_import(ctx, import_id)
        except NoPermissionError as exc:
            raise ForbiddenError(str(exc)) from exc
        except DraftChangedError as exc:
            raise DraftChanged() from exc

        if result.status == ImportStatus.FAILED:
            return result, HTTPStatus.BAD_REQUEST
        return result, HTTPStatus.OK


@openapi_ns.route("/apps/<string:app_id>/dsl")
class AppDslExportApi(Resource):
    """Export an app's current draft configuration as a DSL YAML string.

    The auth pipeline resolves the app and its tenant from ``app_id``.  Pass
    ``include_secret=true`` to embed secret environment variable values in
    plaintext and keep tool credential ids; omit it to produce a DSL safe to share.

    Note: the pipeline enforces ``app.enable_api`` for all ``/apps/<app_id>``
    routes in the openapi group.  Apps with the service API disabled will
    receive a 403; enable the API in the console first if needed.
    """

    @endpoint(
        context="app",
        op="export.console_app.dsl",
        kind=Kind.OBJECT,
        summary="Export app DSL as YAML text inside a JSON object",
        examples=(
            Example(title="Export the current draft as YAML", input={"app_id": "<app_id>"}),
            Example(
                title="Export a published version including secrets",
                input={"app_id": "<app_id>", "workflow_id": "<workflow_id>", "include_secret": True},
            ),
        ),
        requirements=_DSL_READ_GUARDS,
        query=AppDslExportQuery,
        returns=(200, AppDslExportResponse, "Export successful"),
    )
    def get(self, ctx: AppRequestContext, app_id: str, *, query: AppDslExportQuery):
        # Read the hash first: a draft edited in between then refuses the import instead of losing the edit.
        draft_hash = current_draft_token(ctx.tenant_id, ctx.app_id)
        try:
            data = application_services().apps.exports.export_app(
                ctx, AppExportOptions(include_secret=query.include_secret, workflow_id=query.workflow_id)
            )
        except AppDiscoveryNotFoundError as exc:
            raise NotFoundError(str(exc)) from exc
        except WorkflowNotFoundError as exc:
            raise (VersionNotFound() if query.workflow_id else DraftNotFound()) from exc
        except IsDraftWorkflowError as exc:
            raise VersionNotFound() from exc
        return AppDslExportResponse(data=data, draft_hash=draft_hash), 200


@openapi_ns.route("/apps/<string:app_id>/package")
class AppPackageExportApi(Resource):
    """Download an app as a ``.ifpkg`` package (a zip), from its draft or one published version.

    By default roster Agent nodes export as references and only inline Agents are packaged.
    Pass ``preserve_agent_bindings=false`` to package every Agent, to move the app to another workspace.
    """

    @endpoint(
        context="workspace",
        op="export.console_app.package",
        kind=Kind.FILE,
        summary="Download an app as a .ifpkg package: its draft, or one published version",
        examples=(
            Example(title="Export the draft as a package", input={"app_id": "<app_id>"}),
            Example(
                title="Export a published version to move to another workspace",
                input={"app_id": "<app_id>", "workflow_id": "<workflow_id>", "preserve_agent_bindings": False},
            ),
        ),
        requirements=_PACKAGE_READ_GUARDS,
        query=AppPackageExportQuery,
        returns=(HTTPStatus.OK, BinaryFileResponse, "App package"),
    )
    def get(self, ctx: RequestContext, app_id: str, *, query: AppPackageExportQuery):
        options = AppExportOptions(
            format="ifpkg",
            include_secret=query.include_secret,
            workflow_id=query.workflow_id,
            preserve_agent_bindings=query.preserve_agent_bindings,
        )
        try:
            exported = application_services().apps.console.export(ctx, app_id, options)
        except ConsoleAppNotFoundError as exc:
            raise NotFound(str(exc)) from exc
        except WorkflowNotFoundError as exc:
            raise (VersionNotFound() if query.workflow_id else DraftNotFound()) from exc
        except IsDraftWorkflowError as exc:
            raise VersionNotFound() from exc
        if isinstance(exported, str):
            raise TypeError("a package export returned YAML text")
        try:
            response = send_file(
                exported.archive, mimetype="application/zip", as_attachment=True, download_name=exported.filename
            )
        except Exception:
            exported.close()
            raise
        response.call_on_close(exported.close)
        return response


@openapi_ns.route("/apps/<string:app_id>/dependencies:check")
class AppDslCheckDependenciesApi(Resource):
    """Check for leaked plugin dependencies after a DSL import.

    Call this after an import that reported ``COMPLETED_WITH_WARNINGS`` to
    find which plugin dependencies referenced in the DSL are not yet installed
    in the workspace.  Returns an empty ``leaked_dependencies`` list when all
    dependencies are satisfied.
    """

    @endpoint(
        context="workspace",
        op="check.console_app.dependency",
        kind=Kind.OBJECT,
        summary="Check plugin dependencies of an app",
        examples=(Example(title="Check which plugins an app needs", input={"app_id": "<app_id>"}),),
        requirements=_DSL_READ_GUARDS,
        returns=(HTTPStatus.OK, CheckDependenciesResponse, "Dependencies checked"),
    )
    def get(self, ctx: RequestContext, app_id: str):
        result = application_services().apps.imports.check_dependencies(ctx, str(UUID(app_id)))
        missing = [
            dependency.value.plugin_unique_identifier
            for dependency in result.leaked_dependencies
            if dependency.type == PluginDependencyType.Marketplace
        ]
        hints = (
            [
                Hint(
                    summary="Install the missing marketplace plugins",
                    op=op_of(PluginInstallApi.post),
                    input={"workspace_id": ctx.active_workspace_id, "identifiers": missing},
                )
            ]
            if missing
            else []
        )
        return CheckDependenciesResponse(**result.model_dump(), hints=hints), HTTPStatus.OK

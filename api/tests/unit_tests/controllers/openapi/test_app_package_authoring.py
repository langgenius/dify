import io
import itertools
import json
import zipfile
from collections.abc import Callable, Mapping, Sequence
from typing import Protocol, runtime_checkable

import pytest
import yaml
from flask import Flask, Response
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage
from werkzeug.test import TestResponse

from constants.dsl_version import CURRENT_APP_DSL_VERSION
from controllers.openapi import app_dsl
from controllers.openapi._errors import (
    AppPackageInvalid,
    AppPackageTooLarge,
    OpenApiError,
    OpenApiErrorCode,
    OpenApiErrorFormatter,
)
from controllers.openapi._models import (
    AppPackageFillPayload,
    DeclaredParameterRow,
    FieldHintRow,
    PackageCheckResponse,
)
from controllers.openapi._upload import UploadParts
from controllers.openapi.app_dsl import AppPackageCheckApi, AppPackageFillApi
from controllers.openapi.auth.spec import Effect, Kind, spec_of
from core.tools.entities.tool_entities import ToolParameter
from extensions.ext_application_services import ApplicationServices
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.tool.entities import ToolNodeData
from machinery.context import RequestContext
from models.model import AppMode
from models.workflow import Workflow
from services.app_package_service import AppPackageService
from services.entities.dsl_entities import ImportStatus
from services.workflow.authoring.node_spec import FieldHint
from services.workflow.authoring.plugins import NO_DEFAULT, DeclaredParameter
from tests.helpers.unit.model_factories import make_workflow
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld
from tests.unit_tests.services.test_app_package_service import _package_storage
from tests.unit_tests.services.workflow.authoring.test_fill_package import _skeleton_dsl

_CONTEXT = RequestContext("request-1", None, "account-1", "workspace-1")
_APP = "app.yaml"
_MANIFEST = "manifest.yaml"
_LLM_WITHOUT_MODEL = {"id": "llm", "data": {"type": BuiltinNodeTypes.LLM}}


@runtime_checkable
class _FillView(Protocol):
    __handler__: Callable[..., Response]


@runtime_checkable
class _CheckView(Protocol):
    __handler__: Callable[..., tuple[PackageCheckResponse, int]]


def _part(data: bytes, filename: str = "app.ifpkg") -> FileStorage:
    return FileStorage(stream=io.BytesIO(data), filename=filename)


def _folder(files: Mapping[str, bytes]) -> UploadParts:
    return {path: _part(data, path.rsplit("/", 1)[-1]) for path, data in files.items()}


def _zip(members: Mapping[str, bytes]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return output.getvalue()


def _members(content: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def _chain_dsl(*nodes: Mapping[str, object], name: object = "Skeleton") -> bytes:
    ids = [node["id"] for node in nodes]
    edges = [{"source": source, "target": target} for source, target in itertools.pairwise(ids)]
    return yaml.safe_dump(
        {
            "kind": "app",
            "version": CURRENT_APP_DSL_VERSION,
            "app": {"mode": AppMode.WORKFLOW.value, "name": name},
            "workflow": {"graph": {"nodes": [dict(node) for node in nodes], "edges": edges}},
        }
    ).encode()


def _start() -> dict[str, object]:
    return {"id": "start", "data": {"type": BuiltinNodeTypes.START}}


def _end() -> dict[str, object]:
    return {"id": "end", "data": {"type": BuiltinNodeTypes.END}}


def _fill(app: Flask, package: FileStorage | UploadParts) -> Response:
    view = AppPackageFillApi.post
    assert isinstance(view, _FillView)
    with app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/packages:fill", method="POST"):
        response = view.__handler__(
            AppPackageFillApi(), _CONTEXT, workspace_id="workspace-1", body=AppPackageFillPayload(package=package)
        )
        response.direct_passthrough = False
        return response


def _check(app: Flask, package: FileStorage | UploadParts) -> tuple[PackageCheckResponse, int]:
    view = AppPackageCheckApi.post
    assert isinstance(view, _CheckView)
    with app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/packages:check", method="POST"):
        return view.__handler__(
            AppPackageCheckApi(), _CONTEXT, workspace_id="workspace-1", body=AppPackageFillPayload(package=package)
        )


@pytest.mark.parametrize(
    ("view", "kind"),
    [(AppPackageFillApi.post, Kind.FILE), (AppPackageCheckApi.post, Kind.OBJECT)],
)
def test_fill_and_check_read_in_the_workspace_context(view: Callable[..., object], kind: Kind) -> None:
    spec = spec_of(view)
    assert spec is not None
    assert (spec.context, spec.catalog.kind, spec.catalog.effect) == ("workspace", kind, Effect.READ)


def test_fill_sends_a_skeleton_folder_back_as_a_package_the_reader_accepts(app: Flask) -> None:
    response = _fill(app, _folder({_APP: _skeleton_dsl().encode()}))

    assert (response.status_code, response.mimetype) == (200, "application/zip")
    assert "skeleton.ifpkg" in response.headers["Content-Disposition"]
    body = response.get_data()
    assert set(_members(body)) == {_APP, _MANIFEST}
    prepared = AppPackageService().read_package(io.BytesIO(body))
    assert prepared is not None
    prepared.close()


def test_fill_reads_a_file_part_as_the_package(app: Flask) -> None:
    response = _fill(app, _part(_zip({_APP: _skeleton_dsl().encode()})))

    assert response.status_code == 200
    assert set(_members(response.get_data())) == {_APP, _MANIFEST}


@pytest.mark.parametrize(
    "members",
    [
        pytest.param({_APP: b"app: ["}, id="unreadable-yaml"),
        pytest.param({_APP: _chain_dsl(_start(), name=["not", "a", "name"])}, id="name-not-text"),
        pytest.param({"README.md": b"no app here"}, id="no-app-yaml"),
    ],
)
def test_fill_names_a_package_without_a_readable_app_name_app_ifpkg(app: Flask, members: dict[str, bytes]) -> None:
    response = _fill(app, _folder(members))

    assert response.status_code == 200
    assert "filename=app.ifpkg" in response.headers["Content-Disposition"]


def test_check_reports_an_llm_without_a_model_with_a_hint_and_a_spec_per_node(app: Flask) -> None:
    response, status = _check(app, _folder({_APP: _chain_dsl(_start(), _LLM_WITHOUT_MODEL, _end())}))

    assert (status, response.valid) == (200, False)
    [model] = [issue for issue in response.issues if issue.loc == ["nodes", "llm", "data", "model"]]
    assert (model.severity, model.refuses_import, model.node_id) == ("error", True, "llm")
    assert model.hint is not None
    assert (model.hint.loc, model.hint.required) == (["model"], True)
    assert {spec.node_id for spec in response.node_specs} == {"start", "llm", "end"}
    [llm] = [spec for spec in response.node_specs if spec.node_id == "llm"]
    assert (llm.type, llm.version) == (BuiltinNodeTypes.LLM, "1")
    assert llm.schema_["properties"]


def test_check_serializes_the_schema_under_its_name_and_leaves_out_absent_defaults(app: Flask) -> None:
    response, _status = _check(app, _folder({_APP: _chain_dsl(_start(), _LLM_WITHOUT_MODEL, _end())}))

    body = response.model_dump(mode="json", by_alias=True)
    [llm] = [spec for spec in body["node_specs"] if spec["node_id"] == "llm"]
    assert "schema" in llm
    assert "schema_" not in llm
    [model] = [field for field in llm["open_fields"] if field["loc"] == ["model"]]
    assert "default" not in model
    issue = next(issue for issue in body["issues"] if issue["hint"] is not None)
    assert set(issue) == {"code", "severity", "refuses_import", "message", "node_id", "loc", "hint"}


def test_check_of_a_clean_package_is_valid(app: Flask) -> None:
    response, _status = _check(app, _folder({_APP: _chain_dsl(_start(), _end())}))

    assert response.valid is True
    assert all(issue.severity != "error" for issue in response.issues)


@pytest.mark.parametrize("view", [_fill, _check])
@pytest.mark.parametrize(
    ("package", "expected", "status", "error_code", "mentions"),
    [
        pytest.param(
            _part(b"not a zip"),
            AppPackageInvalid,
            400,
            OpenApiErrorCode.APP_PACKAGE_INVALID,
            "not a valid zip",
            id="bad-zip",
        ),
        pytest.param(
            _part(_zip({"../escape.yaml": b"x", _APP: b"a"})),
            AppPackageInvalid,
            400,
            OpenApiErrorCode.APP_PACKAGE_INVALID,
            "../escape.yaml",
            id="unsafe-path",
        ),
        pytest.param(
            _folder({"agents/../../escape.yaml": b"x", _APP: b"a"}),
            AppPackageInvalid,
            400,
            OpenApiErrorCode.APP_PACKAGE_INVALID,
            "agents/../../escape.yaml",
            id="unsafe-folder-path",
        ),
    ],
)
def test_fill_and_check_refuse_a_package_they_cannot_read(
    app: Flask,
    view: Callable[[Flask, FileStorage | UploadParts], object],
    package: FileStorage | UploadParts,
    expected: type[OpenApiError],
    status: int,
    error_code: OpenApiErrorCode,
    mentions: str,
) -> None:
    with pytest.raises(expected) as exc_info:
        view(app, package)

    body = OpenApiErrorFormatter().finalize(exc_info.value, {"message": exc_info.value.description}, status)
    assert (body["status"], body["code"]) == (status, error_code)
    assert mentions in str(body)


@pytest.mark.parametrize("view", [_fill, _check])
@pytest.mark.parametrize(
    ("limits", "members", "mentions"),
    [
        pytest.param({"AGENT_PACKAGE_MAX_ENTRIES": 1}, {_APP: b"a", "notes.md": b"n"}, "more than 1", id="entries"),
        pytest.param({"AGENT_PACKAGE_MAX_BYTES": 8}, {_APP: b"app: {}\n" * 4}, "size", id="bytes"),
    ],
)
def test_fill_and_check_refuse_a_package_file_over_the_limits(
    app: Flask,
    config_overrides: Callable[..., None],
    view: Callable[[Flask, FileStorage | UploadParts], object],
    limits: dict[str, int],
    members: dict[str, bytes],
    mentions: str,
) -> None:
    config_overrides(**limits)

    with pytest.raises(AppPackageTooLarge) as exc_info:
        view(app, _part(_zip(members)))

    assert exc_info.value.code == 413
    assert mentions in str(exc_info.value.description)
    assert "folder" not in str(exc_info.value.description)


def test_check_refuses_a_package_without_an_app_yaml_mapping(app: Flask) -> None:
    with pytest.raises(AppPackageInvalid, match=_APP):
        _check(app, _folder({_APP: b"- a list"}))


def _post(
    world: AdmittedWorld, route: str, files: Mapping[str, bytes], *, fields: Mapping[str, object] | None = None
) -> TestResponse:
    data: dict[str, object] = {
        f"package[{path}]": (io.BytesIO(content), path.rsplit("/", 1)[-1]) for path, content in files.items()
    }
    return world.client.post(
        f"/openapi/v1/workspaces/{world.workspace_id}/apps/{route}",
        data=data | {name: json.dumps(value) for name, value in (fields or {}).items()},
        content_type="multipart/form-data",
        headers=world.headers,
    )


def test_check_answers_over_the_wire_with_the_schema_named_schema(admitted_bearer: AdmittedWorld) -> None:
    response = _post(admitted_bearer, "packages:check", {_APP: _chain_dsl(_start(), _LLM_WITHOUT_MODEL, _end())})

    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body["valid"] is False
    assert {spec["node_id"] for spec in body["node_specs"]} == {"start", "llm", "end"}
    assert all("schema" in spec for spec in body["node_specs"])


def test_fill_answers_over_the_wire_with_the_package(admitted_bearer: AdmittedWorld) -> None:
    response = _post(admitted_bearer, "packages:fill", {_APP: _skeleton_dsl().encode()})

    assert (response.status_code, response.mimetype) == (200, "application/zip")
    assert set(_members(response.get_data())) == {_APP, _MANIFEST}


@pytest.mark.parametrize(("default", "expected"), [(None, {"default": None}), (0, {"default": 0}), (NO_DEFAULT, {})])
def test_a_field_hint_sends_a_null_default_and_leaves_out_a_missing_one(
    default: object, expected: dict[str, object]
) -> None:
    hint = FieldHint(loc=("x",), type="string", options=(), description=None, required=False, default=default)

    body = FieldHintRow.of(hint).model_dump(mode="json", by_alias=True)

    assert {key: value for key, value in body.items() if key == "default"} == expected


@pytest.mark.parametrize(
    ("default", "expected"), [(None, {"default": None}), ("UTC", {"default": "UTC"}), (NO_DEFAULT, {})]
)
def test_a_declared_parameter_sends_a_null_default_and_leaves_out_a_missing_one(
    default: object, expected: dict[str, object]
) -> None:
    parameter = DeclaredParameter(
        name="timezone", form="form", type="select", required=False, default=default, options=(), help=None
    )

    body = DeclaredParameterRow.of(parameter).model_dump(mode="json", by_alias=True)

    assert {key: value for key, value in body.items() if key == "default"} == expected


def _seed(world: AdmittedWorld, query: str, node_type: str) -> dict[str, object]:
    response = world.client.get(
        f"/openapi/v1/workspaces/{world.workspace_id}/node-options?app_mode=workflow&limit=100&{query}",
        headers=world.headers,
    )
    assert response.status_code == 200, response.get_json()
    [seed] = [row["seed"] for row in response.get_json()["data"] if row["type"] == node_type]
    return seed


def _node_data(graph: Mapping[str, Sequence[Mapping[str, object]]], node_id: str) -> dict[str, object]:
    [data] = [node["data"] for node in graph["nodes"] if node["id"] == node_id]
    assert isinstance(data, dict)
    return data


def _app_graph(package: Mapping[str, bytes]) -> Mapping[str, Sequence[Mapping[str, object]]]:
    return yaml.safe_load(package[_APP])["workflow"]["graph"]


def _check_over_the_wire(world: AdmittedWorld, package: Mapping[str, bytes]) -> PackageCheckResponse:
    response = _post(world, "packages:check", package)
    assert response.status_code == 200, response.get_json()
    return PackageCheckResponse.model_validate(response.get_json())


@pytest.mark.usefixtures("time_tool")
def test_an_agent_builds_an_app_from_node_options_through_fill_check_and_import(
    admitted_bearer: AdmittedWorld,
    account_application_services: ApplicationServices,
    sqlite_session: Session,
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    world = admitted_bearer
    _package_storage(monkeypatch, sqlite_engine)
    monkeypatch.setattr(app_dsl, "application_services", lambda: account_application_services)
    sqlite_session.add(make_workflow(tenant_id=world.workspace_id, app_id=world.app_id, created_by=world.member_id))
    sqlite_session.commit()
    nodes = [
        {"id": "start", "data": _seed(world, "kind=block", BuiltinNodeTypes.START)},
        {"id": "now", "data": _seed(world, "kind=tool&keyword=time", BuiltinNodeTypes.TOOL)},
        {"id": "end", "data": _seed(world, "kind=block", BuiltinNodeTypes.END)},
    ]
    edges = [{"source": source["id"], "target": target["id"]} for source, target in itertools.pairwise(nodes)]
    skeleton = yaml.safe_dump(
        {
            "kind": "app",
            "version": CURRENT_APP_DSL_VERSION,
            "app": {"mode": AppMode.WORKFLOW.value, "name": "Current time"},
            "workflow": {"graph": {"nodes": nodes, "edges": edges}},
        }
    ).encode()

    filled = _post(world, "packages:fill", {_APP: skeleton})
    assert (filled.status_code, filled.mimetype) == (200, "application/zip")
    package = _members(filled.get_data())

    first = _check_over_the_wire(world, package)
    assert (first.valid, first.issues) == (True, [])
    assert _node_data(_app_graph(package), "end")["outputs"] == []
    [tool_spec] = [spec for spec in first.node_specs if spec.node_id == "now"]
    declared_defaults = {
        parameter.name: parameter.default
        for parameter in tool_spec.plugin_parameters
        if parameter.form != ToolParameter.ToolParameterForm.LLM and parameter.default is not NO_DEFAULT
    }
    assert declared_defaults

    edited = yaml.safe_load(package[_APP])
    _node_data(edited["workflow"]["graph"], "end")["outputs"] = [
        {"variable": "current_time", "value_type": "string", "value_selector": ["now", "text"]}
    ]
    package[_APP] = yaml.safe_dump(edited).encode()
    second = _check_over_the_wire(world, package)
    assert (second.valid, second.issues) == (True, [])

    refilled = _post(world, "packages:fill", package)
    assert refilled.status_code == 200
    package = _members(refilled.get_data())
    exported = world.client.get(f"/openapi/v1/apps/{world.app_id}/dsl", headers=world.headers)
    assert exported.status_code == 200, exported.get_json()
    imported = _post(
        world, "packages", package, fields={"app_id": world.app_id, "draft_hash": exported.get_json()["draft_hash"]}
    )

    assert imported.status_code == 200, imported.get_json()
    assert (imported.get_json()["status"], imported.get_json()["app_id"]) == (ImportStatus.COMPLETED, world.app_id)
    sqlite_session.expire_all()
    draft = sqlite_session.scalars(
        select(Workflow).where(Workflow.app_id == world.app_id, Workflow.version == Workflow.VERSION_DRAFT)
    ).one()
    tool_configurations = _node_data(draft.graph_dict, "now")["tool_configurations"]
    assert isinstance(tool_configurations, dict)
    assert all(set(value) == {"type", "value"} for value in tool_configurations.values())
    inputs = {name: ToolNodeData.ToolInput.model_validate(value) for name, value in tool_configurations.items()}
    assert {name: tool_input.value for name, tool_input in inputs.items()} == declared_defaults
    assert _node_data(draft.graph_dict, "end")["outputs"] == _node_data(_app_graph(package), "end")["outputs"]

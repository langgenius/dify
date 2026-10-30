from __future__ import annotations

import io
import zipfile
from collections.abc import Callable, Mapping
from typing import Protocol, cast

import pytest
from flask import Flask, Response
from flask.ctx import RequestContext as FlaskRequestContext
from flask_restx import Resource
from pydantic import ValidationError
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import UnprocessableEntity

from configs import dify_config
from constants import BYTES_PER_MIB
from controllers.openapi._contract import accepts
from controllers.openapi._errors import (
    DraftChanged,
    InvalidFilePart,
    OpenApiError,
    OpenApiErrorCode,
    RequestOverRouteLimits,
    SkillNameConflict,
    SkillNameMismatch,
    SkillNotFound,
    SkillPackageInvalid,
    SkillPackageTooLarge,
    SkillRequestRejected,
    SkillsDisabled,
    SkillVersionNotFound,
)
from controllers.openapi._models import (
    SkillDescribeResponse,
    SkillExportQuery,
    SkillImportPayload,
    SkillImportResponse,
    SkillListQuery,
    SkillListResponse,
    SkillPublishPayload,
    SkillPublishResponse,
    SkillVersionListQuery,
    SkillVersionListResponse,
)
from controllers.openapi._upload import UploadParts
from controllers.openapi.auth.pipelines import Pipeline
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.skills import (
    _UPLOAD_CAP,
    ServiceRejection,
    SkillDescribeApi,
    SkillExportApi,
    SkillImportApi,
    SkillListApi,
    SkillPublishApi,
    SkillVersionListApi,
    _draft_hash,
    _expected_updated_at,
    _rejection,
    _skill_upload_parts,
)
from machinery.context import RequestContext
from services.skill_management_service import (
    PublishedSkillArchive,
    SkillErrorDetail,
    SkillManagementService,
    SkillManagementServiceError,
    SkillOverwritePayload,
    SkillServiceErrorCode,
)
from services.skill_management_service import SkillImportPayload as ServiceSkillImportPayload
from services.skill_management_service import SkillPublishPayload as ServiceSkillPublishPayload
from tests.helpers.unit.controllers.openapi.auth._world import TENANT_ID, account_subject, make_ctx, never_reached

WORKSPACE_ID = "ws-id"
SKILL_ID = "11111111-1111-4111-8111-111111111111"
EXISTING_ID = "22222222-2222-4222-8222-222222222222"
UPDATED_AT = 1761200000
SKILL_MD = {"SKILL.md": b"x"}


type Record = dict[str, object]


class Endpoint[T](Protocol):
    __handler__: Callable[..., T]
    __spec__: EndpointSpec


def _context() -> RequestContext:
    return RequestContext(request_id="r", trace_id=None, account_id="acct-id", active_workspace_id=WORKSPACE_ID)


def _skill(**extra: object) -> Record:
    return {
        "id": SKILL_ID,
        "name": "expense-sop",
        "display_name": "Expense SOP",
        "description": "How to file expenses",
        "icon": None,
        "tags": ["ops"],
        "latest_published_version_id": "ver-2",
        "updated_at": UPDATED_AT,
        "files": [{"path": "SKILL.md"}],
        **extra,
    }


def _version(number: int, *, latest: bool = False) -> Record:
    return {
        "id": f"ver-{number}",
        "version_number": number,
        "version_name": None,
        "publish_note": "",
        "published_by": "acct-id",
        "is_latest": latest,
        "created_at": UPDATED_AT + number,
    }


def _stub(monkeypatch: pytest.MonkeyPatch, name: str, replacement: Callable[..., object]) -> None:
    def stand_in(_service: SkillManagementService, **kwargs: object) -> object:
        return replacement(**kwargs)

    monkeypatch.setattr(SkillManagementService, name, stand_in)


def _record(monkeypatch: pytest.MonkeyPatch, name: str, result: object) -> list[Record]:
    """Stub a service method that returns ``result`` and keeps the keyword arguments of each call."""
    seen: list[Record] = []

    def record(**kwargs: object) -> object:
        seen.append(kwargs)
        return result

    _stub(monkeypatch, name, record)
    return seen


def _reject(code: str, **details: object) -> Callable[..., object]:
    def reject(**_kwargs: object) -> object:
        raise SkillManagementServiceError(code, "rejected", details=details)

    return reject


def _call(api: Resource, view: object, *args: object, **kwargs: object) -> object:
    return cast(Endpoint[object], view).__handler__(api, _context(), WORKSPACE_ID, *args, **kwargs)


def _folder(files: Mapping[str, bytes]) -> UploadParts:
    return {path: FileStorage(stream=io.BytesIO(data)) for path, data in files.items()}


def _import(files: Mapping[str, bytes], **fields: object) -> tuple[SkillImportResponse, int]:
    body = SkillImportPayload.model_validate({"files": _folder(files), **fields})
    return cast(tuple[SkillImportResponse, int], _call(SkillImportApi(), SkillImportApi.post, body=body))


def _archive(filename: str) -> PublishedSkillArchive:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("expense-sop/SKILL.md", "---\nname: expense-sop\n---\n")
    return PublishedSkillArchive(filename=filename, mime_type="application/zip", payload=buffer.getvalue())


_HANDLER_CALLS: Mapping[str, Callable[[], object]] = {
    "get_skill": lambda: _call(SkillDescribeApi(), SkillDescribeApi.get, SKILL_ID),
    "export_version_archive": lambda: _call(
        SkillExportApi(), SkillExportApi.get, SKILL_ID, query=SkillExportQuery(version_id=SKILL_ID)
    ),
    "publish_skill": lambda: _call(SkillPublishApi(), SkillPublishApi.post, SKILL_ID, body=SkillPublishPayload()),
    "import_skill": lambda: _import(SKILL_MD),
    "overwrite_skill": lambda: _import(SKILL_MD, skill_id=SKILL_ID),
}


def test_every_mapped_code_is_a_service_code() -> None:
    assert {rejection.value for rejection in ServiceRejection} <= {code.value for code in SkillServiceErrorCode}


def test_rejection_relays_unknown_codes_with_their_status() -> None:
    error = _rejection(SkillManagementServiceError("brand_new_code", "msg", status_code=422, details={"a": 1}))
    assert isinstance(error, SkillRequestRejected)
    assert (error.code, error.description) == (422, "msg")
    assert error.details is not None
    assert [(d.type, d.loc, d.msg) for d in error.details] == [
        ("brand_new_code", [], "msg"),
        ("brand_new_code", ["a"], "1"),
    ]


@pytest.mark.parametrize(
    ("method", "code", "error_type", "status"),
    [
        ("get_skill", SkillServiceErrorCode.SKILL_NOT_FOUND, SkillNotFound, 404),
        ("export_version_archive", SkillServiceErrorCode.SKILL_VERSION_NOT_FOUND, SkillVersionNotFound, 404),
        ("overwrite_skill", SkillServiceErrorCode.SKILL_CONFLICT, DraftChanged, 409),
        ("import_skill", SkillServiceErrorCode.SKILL_NAME_CONFLICT, SkillNameConflict, 409),
        ("overwrite_skill", SkillServiceErrorCode.SKILL_NAME_MISMATCH, SkillNameMismatch, 400),
        ("publish_skill", SkillServiceErrorCode.INVALID_SKILL_MD, SkillPackageInvalid, 400),
        ("overwrite_skill", SkillServiceErrorCode.MISSING_SKILL_NAME, SkillPackageInvalid, 400),
        ("overwrite_skill", SkillServiceErrorCode.INVALID_SKILL_NAME, SkillPackageInvalid, 400),
        *(("import_skill", code, code.error, 400) for code in ServiceRejection if code.error is SkillPackageInvalid),
        *(("import_skill", code, code.error, 413) for code in ServiceRejection if code.error is SkillPackageTooLarge),
    ],
    ids=lambda value: value.__name__ if isinstance(value, type) else None,
)
def test_handlers_answer_a_service_rejection_with_its_error_and_message(
    app: Flask, monkeypatch: pytest.MonkeyPatch, method: str, code: str, error_type: type[OpenApiError], status: int
) -> None:
    _stub(monkeypatch, method, _reject(code))
    with app.test_request_context(), pytest.raises(error_type) as exc:
        _HANDLER_CALLS[method]()
    assert (exc.value.code, exc.value.description) == (status, "rejected")


def test_draft_hash_is_epoch_seconds() -> None:
    assert _draft_hash(1761200000) == "1761200000"
    assert _expected_updated_at("1761200000") == 1761200000
    assert _expected_updated_at(None) is None


@pytest.mark.parametrize(
    ("api", "view", "kwargs"),
    [
        (SkillDescribeApi, SkillDescribeApi.get, {}),
        (SkillVersionListApi, SkillVersionListApi.get, {"query": SkillVersionListQuery(page=1, limit=2)}),
        (SkillExportApi, SkillExportApi.get, {"query": SkillExportQuery()}),
        (SkillPublishApi, SkillPublishApi.post, {"body": SkillPublishPayload()}),
    ],
)
def test_non_uuid_skill_id_is_404(api: type[Resource], view: object, kwargs: dict[str, object]) -> None:
    with pytest.raises(SkillNotFound):
        _call(api(), view, "not-a-uuid", **kwargs)


def test_list_skills_passes_filters_and_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    page = {"data": [_skill()], "total": 11, "page": 2, "limit": 5, "has_more": True}
    seen = _record(monkeypatch, "list_skills", page)
    query = SkillListQuery.model_validate({"keyword": "sop", "tag": ["ops"], "page": 2, "limit": 5})
    result = cast(SkillListResponse, _call(SkillListApi(), SkillListApi.get, query=query))
    assert seen == [{"tenant_id": WORKSPACE_ID, "keyword": "sop", "tags": ["ops"], "page": 2, "limit": 5}]
    assert (result.page, result.limit, result.total, result.has_more) == (2, 5, 11, True)
    assert result.data[0].name == "expense-sop"


@pytest.mark.parametrize(
    ("versions", "latest"),
    [([_version(2, latest=True), _version(1)], {"id": "ver-2", "created_by": "acct-id"}), ([], None)],
    ids=["published", "never-published"],
)
def test_describe_skill_returns_draft_hash_and_latest_version(
    monkeypatch: pytest.MonkeyPatch, versions: list[Record], latest: Record | None
) -> None:
    _stub(monkeypatch, "get_skill", lambda **_: _skill())
    _stub(monkeypatch, "list_versions", lambda **_: {"data": versions})
    result = cast(SkillDescribeResponse, _call(SkillDescribeApi(), SkillDescribeApi.get, SKILL_ID))
    assert result.draft_hash == str(UPDATED_AT)
    assert result.model_dump(include={"latest_version": {"id", "created_by"}}) == {"latest_version": latest}
    assert "files" not in result.model_dump()


def test_list_versions_newest_first_and_paged(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, "list_versions", lambda **_: {"data": [_version(3, latest=True), _version(2), _version(1)]})
    query = SkillVersionListQuery(page=1, limit=2)
    result = cast(
        SkillVersionListResponse, _call(SkillVersionListApi(), SkillVersionListApi.get, SKILL_ID, query=query)
    )
    assert [row.version_number for row in result.data] == [3, 2]
    assert (result.has_more, result.total) == (True, 3)


@pytest.mark.parametrize(
    ("method", "version", "filename"),
    [("export_draft_archive", {}, "expense-sop.zip"), ("export_version_archive", {"version_id": SKILL_ID}, "v2.zip")],
    ids=["draft", "version"],
)
def test_export_sends_the_zip_as_an_attachment(
    app: Flask, monkeypatch: pytest.MonkeyPatch, method: str, version: dict[str, str], filename: str
) -> None:
    seen = _record(monkeypatch, method, _archive(filename))
    query = SkillExportQuery.model_validate(version)
    with app.test_request_context():
        response = cast(Response, _call(SkillExportApi(), SkillExportApi.get, SKILL_ID, query=query))
    assert seen == [{"tenant_id": WORKSPACE_ID, "skill_id": SKILL_ID, **version}]
    assert response.mimetype == "application/zip"
    assert response.headers["Content-Disposition"] == f"attachment; filename={filename}"
    response.direct_passthrough = False
    assert zipfile.ZipFile(io.BytesIO(response.get_data())).namelist() == ["expense-sop/SKILL.md"]


def test_publish_passes_name_and_note(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _record(monkeypatch, "publish_skill", _version(2, latest=True))
    body = SkillPublishPayload(version_name="v2", publish_note="retry")
    result = cast(SkillPublishResponse, _call(SkillPublishApi(), SkillPublishApi.post, SKILL_ID, body=body))
    assert seen == [
        {
            "tenant_id": WORKSPACE_ID,
            "user_id": "acct-id",
            "skill_id": SKILL_ID,
            "payload": ServiceSkillPublishPayload(version_name="v2", publish_note="retry"),
        }
    ]
    assert (result.version_number, result.created_by) == (2, "acct-id")


def test_import_folder_creates_skill(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _record(monkeypatch, "import_skill", _skill(files=[{"path": "SKILL.md"}, {"path": "scripts/run.py"}]))
    response, status = _import({"SKILL.md": b"---\nname: expense-sop\n---\n", "scripts/run.py": b"x"})
    assert status == 201
    [sent] = seen
    assert (sent["tenant_id"], sent["user_id"]) == (WORKSPACE_ID, "acct-id")
    payload = cast(ServiceSkillImportPayload, sent["payload"])
    assert zipfile.ZipFile(io.BytesIO(payload.content)).namelist() == ["SKILL.md", "scripts/run.py"]
    expected = (SKILL_ID, "expense-sop", str(UPDATED_AT), 2)
    assert (response.id, response.name, response.draft_hash, response.file_count) == expected
    [hint] = response.hints
    assert (hint.op, hint.input) == ("publish.skill", {"workspace_id": WORKSPACE_ID, "skill_id": SKILL_ID})


def test_import_with_skill_id_overwrites(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _record(monkeypatch, "overwrite_skill", _skill())
    _stub(monkeypatch, "import_skill", lambda **_: pytest.fail("must not create"))
    response, status = _import(SKILL_MD, skill_id=SKILL_ID, draft_hash="1761200000")
    assert status == 200
    [sent] = seen
    assert sent["skill_id"] == SKILL_ID
    assert cast(SkillOverwritePayload, sent["payload"]).expected_updated_at == 1761200000
    assert response.hints[0].op == "publish.skill"


@pytest.mark.parametrize(
    ("fields", "loc"),
    [
        ({"skill_id": SKILL_ID, "draft_hash": "abc"}, "draft_hash"),
        ({"skill_id": SKILL_ID, "draft_hash": "١٢٣"}, "draft_hash"),
        ({"skill_id": "not-a-uuid"}, "skill_id"),
        ({"draft_hash": "1761200000"}, "draft_hash"),
    ],
    ids=["letters-draft-hash", "non-ascii-digits-draft-hash", "non-uuid-skill-id", "draft-hash-without-skill-id"],
)
def test_import_payload_rejects_a_bad_field(fields: Record, loc: str) -> None:
    with pytest.raises(ValidationError) as exc:
        SkillImportPayload.model_validate({"files": _folder(SKILL_MD), **fields})
    assert [error["loc"] for error in exc.value.errors()] == [(loc,)]


@pytest.mark.parametrize(
    ("method", "details", "hints"),
    [
        (
            "import_skill",
            {SkillErrorDetail.SKILL_ID: EXISTING_ID},
            [("import.skill", {"workspace_id": WORKSPACE_ID, "skill_id": EXISTING_ID, "files": None})],
        ),
        (
            "import_skill",
            {SkillErrorDetail.NAME: "expense-sop"},
            [("get.skill", {"workspace_id": WORKSPACE_ID, "keyword": "expense-sop"})],
        ),
        ("overwrite_skill", {}, []),
    ],
    ids=["pre-check-overwrites-the-existing-skill", "commit-race-searches-by-name", "nothing-to-point-at"],
)
def test_import_name_conflict_hints_at_the_clashing_skill(
    monkeypatch: pytest.MonkeyPatch, method: str, details: Record, hints: list[tuple[str, Record]]
) -> None:
    _stub(monkeypatch, method, _reject(SkillServiceErrorCode.SKILL_NAME_CONFLICT, **details))
    with pytest.raises(SkillNameConflict) as exc:
        _HANDLER_CALLS[method]()
    assert exc.value.error_code == OpenApiErrorCode.SKILL_NAME_CONFLICT
    assert exc.value.hints is not None
    assert [(hint.op, hint.input) for hint in exc.value.hints] == hints


@pytest.mark.parametrize(
    ("limit", "files", "message"),
    [
        (
            {"UPLOAD_SKILL_FILE_SIZE_LIMIT": 1},
            {"SKILL.md": b"x" * (2 * BYTES_PER_MIB)},
            "The skill folder is over 1 MiB",
        ),
        (
            {"SKILL_PACKAGE_MAX_ENTRIES": 2},
            {"SKILL.md": b"x", "a.txt": b"x", "b.txt": b"x"},
            "The skill folder has more than 2 files",
        ),
    ],
    ids=["bytes", "files"],
)
def test_import_folder_over_a_limit_is_413_naming_the_limit(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    limit: Record,
    files: Mapping[str, bytes],
    message: str,
) -> None:
    config_overrides(**limit)
    _stub(monkeypatch, "import_skill", lambda **_: pytest.fail("must not reach the service"))
    with pytest.raises(SkillPackageTooLarge) as exc:
        _import(files)
    assert (exc.value.code, exc.value.description) == (413, message)


def test_import_part_cap_counts_files_and_fields(
    app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert _skill_upload_parts() == dify_config.SKILL_PACKAGE_MAX_ENTRIES + 2
    monkeypatch.setattr(dify_config, "SKILL_PACKAGE_MAX_ENTRIES", 2)
    assert _skill_upload_parts() == 4

    @accepts(body=SkillImportPayload)
    def handler(*, body: SkillImportPayload) -> int:
        return len(body.files)

    def post(*paths: str) -> FlaskRequestContext:
        data: dict[str, object] = {
            "skill_id": f'"{SKILL_ID}"',
            "draft_hash": '"1761200000"',
            **{f"files[{path}]": (io.BytesIO(b"x"), path) for path in paths},
        }
        return app.test_request_context("/x", method="POST", data=data, content_type="multipart/form-data")

    with post("SKILL.md", "a.txt"):
        _UPLOAD_CAP.run(account_subject(), make_ctx(sqlite_session), sqlite_session)
        assert handler() == 2
    with post("SKILL.md", "a.txt", "b.txt"):
        _UPLOAD_CAP.run(account_subject(), make_ctx(sqlite_session), sqlite_session)
        with pytest.raises(RequestOverRouteLimits, match="at most 4 parts"):
            handler()


def test_import_bad_path_names_the_path() -> None:
    with pytest.raises(SkillPackageInvalid) as exc:
        _import({"SKILL.md": b"x", "a/../b": b"x"})
    assert exc.value.details is not None
    assert any(detail.loc == ["a/../b"] for detail in exc.value.details)
    assert "a/../b" in str(exc.value.description)


def test_import_only_junk_is_rejected() -> None:
    with pytest.raises(SkillPackageInvalid):
        _import({".DS_Store": b"x"})


@pytest.mark.parametrize(
    ("data", "error_type", "match"),
    [
        (
            {"files[SKILL.md]": [(io.BytesIO(b"a"), "SKILL.md"), (io.BytesIO(b"b"), "SKILL.md")]},
            InvalidFilePart,
            "SKILL.md",
        ),
        ({"files[SKILL.md]": (io.BytesIO(b"x"), "SKILL.md"), "force": "true"}, UnprocessableEntity, None),
    ],
    ids=["same-path-twice", "unknown-field"],
)
def test_import_body_is_rejected_before_parsing(
    app: Flask, data: Record, error_type: type[Exception], match: str | None
) -> None:
    @accepts(body=SkillImportPayload)
    def handler(**_kwargs: object) -> None:
        pytest.fail("must not parse")

    with (
        app.test_request_context("/x", method="POST", data=data, content_type="multipart/form-data"),
        pytest.raises(error_type, match=match),
    ):
        handler()


@pytest.mark.parametrize(
    "view",
    [
        SkillListApi.get,
        SkillDescribeApi.get,
        SkillVersionListApi.get,
        SkillExportApi.get,
        SkillPublishApi.post,
        SkillImportApi.post,
    ],
)
def test_skills_off_is_503_before_membership_and_permission_checks(
    sqlite_session: Session, config_overrides: Callable[..., None], view: object
) -> None:
    """The caller is not a member of the workspace, so any earlier check would refuse it first."""
    config_overrides(ENABLE_SKILL=False, RBAC_ENABLED=True)
    subject = account_subject()
    with pytest.raises(SkillsDisabled):
        Pipeline().run(
            subject=subject,
            auth=subject.auth,
            spec=cast(Endpoint[object], view).__spec__,
            ctx=make_ctx(sqlite_session, subject=subject, workspace_id=TENANT_ID),
            session=sqlite_session,
            call=never_reached,
        )

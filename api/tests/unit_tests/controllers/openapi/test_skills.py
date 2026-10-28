from __future__ import annotations

import io
import zipfile
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol, cast

import pytest
from flask import Flask, Response
from flask.ctx import RequestContext as FlaskRequestContext
from flask_restx import Resource
from pydantic import ValidationError
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import BadRequest, UnprocessableEntity

from configs import dify_config
from controllers.openapi._contract import accepts
from controllers.openapi._errors import (
    DraftChanged,
    InvalidFilePart,
    RequestOverRouteLimits,
    SkillNameMismatch,
    SkillNameTaken,
    SkillNotFound,
    SkillPackageInvalid,
    SkillPackageTooLarge,
    SkillRequestRejected,
    SkillVersionNotFound,
)
from controllers.openapi._models import (
    SkillDescribeResponse,
    SkillExportQuery,
    SkillImportBody,
    SkillImportResponse,
    SkillListQuery,
    SkillListResponse,
    SkillPublishPayload,
    SkillPublishResponse,
    SkillVersionListQuery,
    SkillVersionListResponse,
)
from controllers.openapi._upload import UploadParts
from controllers.openapi.skills import (
    _PACKAGE_CODES,
    _TOO_LARGE_CODES,
    _UPLOAD_CAP,
    ServiceCode,
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
    SkillImportPayload,
    SkillManagementService,
    SkillManagementServiceError,
    SkillOverwritePayload,
)
from services.skill_management_service import SkillPublishPayload as ServiceSkillPublishPayload
from tests.helpers.unit.controllers.openapi.auth._world import account_subject, make_ctx

WORKSPACE_ID = "ws-id"
UPDATED_AT = 1761200000


type Record = dict[str, object]


class Endpoint[T](Protocol):
    __handler__: Callable[..., T]


@dataclass
class Calls:
    list_skills: list[Record] = field(default_factory=list)
    publish: list[Record] = field(default_factory=list)


def _context() -> RequestContext:
    return RequestContext(request_id="r", trace_id=None, account_id="acct-id", active_workspace_id=WORKSPACE_ID)


def _skill(**extra: object) -> Record:
    return {
        "id": "skill-1",
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
        "skill_id": "skill-1",
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


def _missing(**_kwargs: object) -> object:
    raise SkillManagementServiceError("skill_not_found", "skill not found", status_code=404)


def _call(api: Resource, view: object, *args: object, **kwargs: object) -> object:
    return cast(Endpoint[object], view).__handler__(api, _context(), WORKSPACE_ID, *args, **kwargs)


def test_rejection_maps_known_codes() -> None:
    assert isinstance(_rejection(SkillManagementServiceError("skill_not_found", "x", status_code=404)), SkillNotFound)
    assert isinstance(
        _rejection(SkillManagementServiceError("skill_version_not_found", "x", status_code=404)), SkillVersionNotFound
    )
    assert isinstance(_rejection(SkillManagementServiceError("skill_conflict", "x", status_code=409)), DraftChanged)
    assert isinstance(
        _rejection(SkillManagementServiceError("skill_name_conflict", "x", status_code=409)), SkillNameTaken
    )
    assert isinstance(_rejection(SkillManagementServiceError("skill_name_mismatch", "x")), SkillNameMismatch)


@pytest.mark.parametrize("code", _PACKAGE_CODES)
def test_rejection_maps_package_codes(code: ServiceCode) -> None:
    assert isinstance(_rejection(SkillManagementServiceError(code, "x")), SkillPackageInvalid)


@pytest.mark.parametrize("code", _TOO_LARGE_CODES)
def test_rejection_maps_size_codes_to_413(code: ServiceCode) -> None:
    error = _rejection(SkillManagementServiceError(code, "x"))
    assert isinstance(error, SkillPackageTooLarge)
    assert error.code == 413


def test_rejection_relays_unknown_codes_with_their_status() -> None:
    error = _rejection(SkillManagementServiceError("brand_new_code", "msg", status_code=422, details={"a": 1}))
    assert isinstance(error, SkillRequestRejected)
    assert error.code == 422
    assert error.description == "msg"
    assert error.details is not None
    assert [(d.type, d.loc, d.msg) for d in error.details] == [
        ("brand_new_code", [], "msg"),
        ("brand_new_code", ["a"], "1"),
    ]


def test_draft_hash_is_epoch_seconds() -> None:
    assert _draft_hash(1761200000) == "1761200000"
    assert _expected_updated_at("1761200000") == 1761200000
    assert _expected_updated_at(None) is None
    with pytest.raises(BadRequest):
        _expected_updated_at("not-a-number")


def test_list_skills_passes_filters_and_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = Calls()

    def list_skills(**kwargs: object) -> Record:
        calls.list_skills.append(kwargs)
        return {"data": [_skill()], "total": 11, "page": 2, "limit": 5, "has_more": True}

    _stub(monkeypatch, "list_skills", list_skills)
    query = SkillListQuery.model_validate({"keyword": "sop", "tag": ["ops"], "page": 2, "limit": 5})
    result = cast(SkillListResponse, _call(SkillListApi(), SkillListApi.get, query=query))
    assert calls.list_skills == [{"tenant_id": "ws-id", "keyword": "sop", "tags": ["ops"], "page": 2, "limit": 5}]
    assert (result.page, result.limit, result.total, result.has_more) == (2, 5, 11, True)
    assert result.data[0].name == "expense-sop"


def test_describe_skill_returns_draft_hash_and_latest_version(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, "get_skill", lambda **_: _skill())
    _stub(monkeypatch, "list_versions", lambda **_: {"data": [_version(2, latest=True), _version(1)]})
    result = cast(SkillDescribeResponse, _call(SkillDescribeApi(), SkillDescribeApi.get, "skill-1"))
    assert result.draft_hash == str(UPDATED_AT)
    assert result.latest_version is not None
    assert result.latest_version.id == "ver-2"
    assert result.latest_version.created_by == "acct-id"
    assert "files" not in result.model_dump()


def test_describe_skill_without_versions_has_no_latest_version(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, "get_skill", lambda **_: _skill(latest_published_version_id=None))
    _stub(monkeypatch, "list_versions", lambda **_: {"data": []})
    result = cast(SkillDescribeResponse, _call(SkillDescribeApi(), SkillDescribeApi.get, "skill-1"))
    assert result.latest_version is None


def test_describe_unknown_skill_is_404(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, "get_skill", _missing)
    with pytest.raises(SkillNotFound):
        _call(SkillDescribeApi(), SkillDescribeApi.get, "skill-1")


def test_list_versions_newest_first_and_paged(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, "list_versions", lambda **_: {"data": [_version(3, latest=True), _version(2), _version(1)]})
    result = cast(
        SkillVersionListResponse,
        _call(SkillVersionListApi(), SkillVersionListApi.get, "skill-1", query=SkillVersionListQuery(page=1, limit=2)),
    )
    assert [row.version_number for row in result.data] == [3, 2]
    assert result.has_more is True
    assert result.total == 3


def _archive(filename: str) -> PublishedSkillArchive:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("expense-sop/SKILL.md", "---\nname: expense-sop\n---\n")
    return PublishedSkillArchive(filename=filename, mime_type="application/zip", payload=buffer.getvalue())


def test_export_draft_sends_zip_attachment(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, "export_draft_archive", lambda **_: _archive("expense-sop.zip"))
    with app.test_request_context():
        response = cast(Response, _call(SkillExportApi(), SkillExportApi.get, "skill-1", query=SkillExportQuery()))
    assert response.mimetype == "application/zip"
    assert "filename=expense-sop.zip" in response.headers["Content-Disposition"]
    assert "attachment" in response.headers["Content-Disposition"]
    response.direct_passthrough = False
    assert zipfile.ZipFile(io.BytesIO(response.get_data())).namelist() == ["expense-sop/SKILL.md"]


def test_export_version_uses_version_archive(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[Record] = []

    def export_version(**kwargs: object) -> PublishedSkillArchive:
        seen.append(kwargs)
        return _archive("expense-sop-v2.zip")

    _stub(monkeypatch, "export_version_archive", export_version)
    version_id = "11111111-1111-4111-8111-111111111111"
    with app.test_request_context():
        response = cast(
            Response,
            _call(SkillExportApi(), SkillExportApi.get, "skill-1", query=SkillExportQuery(version_id=version_id)),
        )
    assert seen == [{"tenant_id": "ws-id", "skill_id": "skill-1", "version_id": version_id}]
    assert "filename=expense-sop-v2.zip" in response.headers["Content-Disposition"]


def test_export_version_of_other_skill_is_404(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    def other_skills_version(**_kwargs: object) -> PublishedSkillArchive:
        raise SkillManagementServiceError("skill_version_not_found", "skill version not found", status_code=404)

    _stub(monkeypatch, "export_version_archive", other_skills_version)
    with app.test_request_context(), pytest.raises(SkillVersionNotFound):
        _call(
            SkillExportApi(),
            SkillExportApi.get,
            "skill-1",
            query=SkillExportQuery(version_id="11111111-1111-4111-8111-111111111111"),
        )


def test_publish_passes_name_and_note(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = Calls()

    def publish(**kwargs: object) -> Record:
        calls.publish.append(kwargs)
        return _version(2, latest=True)

    _stub(monkeypatch, "publish_skill", publish)
    result = cast(
        SkillPublishResponse,
        _call(
            SkillPublishApi(),
            SkillPublishApi.post,
            "skill-1",
            body=SkillPublishPayload(version_name="v2", publish_note="retry"),
        ),
    )
    assert len(calls.publish) == 1
    sent = calls.publish[0]
    assert (sent["tenant_id"], sent["user_id"], sent["skill_id"]) == ("ws-id", "acct-id", "skill-1")
    assert sent["payload"] == ServiceSkillPublishPayload(version_name="v2", publish_note="retry")
    assert result.version_number == 2
    assert result.created_by == "acct-id"


def test_publish_invalid_frontmatter_is_package_invalid(monkeypatch: pytest.MonkeyPatch) -> None:
    def invalid(**_kwargs: object) -> Record:
        raise SkillManagementServiceError("invalid_skill_md", "SKILL.md frontmatter is not valid YAML")

    _stub(monkeypatch, "publish_skill", invalid)
    with pytest.raises(SkillPackageInvalid):
        _call(SkillPublishApi(), SkillPublishApi.post, "skill-1", body=SkillPublishPayload())


def _folder(**files: bytes) -> UploadParts:
    return {path.replace("__", "/"): FileStorage(stream=io.BytesIO(data)) for path, data in files.items()}


def _import(parts: UploadParts, **fields: object) -> tuple[SkillImportResponse, int]:
    body = SkillImportBody.model_validate({"files": parts, **fields})
    result = _call(SkillImportApi(), SkillImportApi.post, body=body)
    return cast(tuple[SkillImportResponse, int], result)


def test_import_folder_creates_skill(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[Record] = []

    def create(**kwargs: object) -> Record:
        sent.append(kwargs)
        return _skill(files=[{"path": "SKILL.md"}, {"path": "scripts/run.py"}])

    _stub(monkeypatch, "import_skill", create)
    response, status = _import(_folder(**{"SKILL.md": b"---\nname: expense-sop\n---\n", "scripts__run.py": b"x"}))
    assert status == 201
    assert len(sent) == 1
    payload = cast(SkillImportPayload, sent[0]["payload"])
    assert (sent[0]["tenant_id"], sent[0]["user_id"]) == ("ws-id", "acct-id")
    assert zipfile.ZipFile(io.BytesIO(payload.content)).namelist() == ["SKILL.md", "scripts/run.py"]
    assert (response.id, response.name, response.draft_hash, response.file_count) == (
        "skill-1",
        "expense-sop",
        str(UPDATED_AT),
        2,
    )
    [hint] = response.hints
    assert hint.op == "publish.skill"
    assert hint.input == {"workspace_id": WORKSPACE_ID, "skill_id": "skill-1"}


def test_import_with_skill_id_overwrites(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[Record] = []

    def overwrite(**kwargs: object) -> Record:
        sent.append(kwargs)
        return _skill()

    _stub(monkeypatch, "overwrite_skill", overwrite)
    _stub(monkeypatch, "import_skill", lambda **_: pytest.fail("must not create"))
    skill_id = "11111111-1111-4111-8111-111111111111"
    response, status = _import(_folder(**{"SKILL.md": b"x"}), skill_id=skill_id, draft_hash="1761200000")
    assert status == 200
    payload = cast(SkillOverwritePayload, sent[0]["payload"])
    assert sent[0]["skill_id"] == skill_id
    assert payload.expected_updated_at == 1761200000
    assert response.hints[0].op == "publish.skill"


def test_import_with_foreign_draft_hash_is_rejected() -> None:
    skill_id = "11111111-1111-4111-8111-111111111111"
    with pytest.raises(BadRequest):
        _import(_folder(**{"SKILL.md": b"x"}), skill_id=skill_id, draft_hash="abc")


def test_import_name_taken_hints_overwrite(monkeypatch: pytest.MonkeyPatch) -> None:
    def taken(**_kwargs: object) -> Record:
        raise SkillManagementServiceError("skill_name_conflict", "skill name already exists", status_code=409)

    _stub(monkeypatch, "import_skill", taken)
    with pytest.raises(SkillNameTaken) as exc:
        _import(_folder(**{"SKILL.md": b"x"}))
    [hint] = exc.value.hints or []
    assert hint.op == "import.skill"
    assert hint.input == {"workspace_id": WORKSPACE_ID, "skill_id": None, "files": None}


def test_import_name_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    def mismatch(**_kwargs: object) -> Record:
        raise SkillManagementServiceError("skill_name_mismatch", "name differs", details={"expected": "a", "got": "b"})

    _stub(monkeypatch, "overwrite_skill", mismatch)
    with pytest.raises(SkillNameMismatch):
        _import(_folder(**{"SKILL.md": b"x"}), skill_id="11111111-1111-4111-8111-111111111111")


def test_import_folder_too_big_is_413_naming_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "UPLOAD_SKILL_FILE_SIZE_LIMIT", 1)
    _stub(monkeypatch, "import_skill", lambda **_: pytest.fail("must not reach the service"))
    with pytest.raises(SkillPackageTooLarge) as exc:
        _import(_folder(**{"SKILL.md": b"x" * (2 * 1024 * 1024)}))
    assert exc.value.code == 413
    assert "1 MiB" in str(exc.value.description)


def test_import_too_many_files_is_413_naming_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "SKILL_PACKAGE_MAX_ENTRIES", 2)
    with pytest.raises(SkillPackageTooLarge) as exc:
        _import(_folder(**{"SKILL.md": b"x", "a.txt": b"x", "b.txt": b"x"}))
    assert "2 files" in str(exc.value.description)


def test_import_part_cap_counts_files_and_fields(
    app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert _skill_upload_parts() == dify_config.SKILL_PACKAGE_MAX_ENTRIES + 2
    monkeypatch.setattr(dify_config, "SKILL_PACKAGE_MAX_ENTRIES", 2)
    assert _skill_upload_parts() == 4

    @accepts(body=SkillImportBody)
    def handler(*, body: SkillImportBody) -> int:
        return len(body.files)

    def post(*paths: str) -> FlaskRequestContext:
        data: dict[str, object] = {
            "skill_id": '"11111111-1111-4111-8111-111111111111"',
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
        _import(_folder(**{"SKILL.md": b"x", "a/../b": b"x"}))
    assert exc.value.details is not None
    assert any(detail.loc == ["a/../b"] for detail in exc.value.details)
    assert "a/../b" in str(exc.value.description)


def test_import_only_junk_is_rejected() -> None:
    with pytest.raises(SkillPackageInvalid):
        _import(_folder(**{".DS_Store": b"x"}))


def test_import_same_path_twice_is_rejected(app: Flask) -> None:
    data = {"files[SKILL.md]": [(io.BytesIO(b"a"), "SKILL.md"), (io.BytesIO(b"b"), "SKILL.md")]}

    @accepts(body=SkillImportBody)
    def handler(**_kwargs: object) -> None:
        pytest.fail("must not parse")

    with (
        app.test_request_context("/x", method="POST", data=data, content_type="multipart/form-data"),
        pytest.raises(InvalidFilePart, match="SKILL.md"),
    ):
        handler()


def test_import_unknown_body_field_rejected(app: Flask) -> None:
    @accepts(body=SkillImportBody)
    def handler(**_kwargs: object) -> None:
        pytest.fail("must not parse")

    data = {"files[SKILL.md]": (io.BytesIO(b"x"), "SKILL.md"), "force": "true"}
    with (
        app.test_request_context("/x", method="POST", data=data, content_type="multipart/form-data"),
        pytest.raises(UnprocessableEntity),
    ):
        handler()


def test_import_draft_hash_without_skill_id_is_rejected() -> None:
    with pytest.raises(ValidationError) as exc:
        SkillImportBody.model_validate({"files": _folder(**{"SKILL.md": b"x"}), "draft_hash": "1761200000"})
    assert [error["loc"] for error in exc.value.errors()] == [("draft_hash",)]

from io import BytesIO
from unittest.mock import MagicMock

import pytest

from services.entities.file_grant_entities import (
    FileGrantContext,
    FileGrantLimits,
    FileGrantMintRequest,
    FileGrantScope,
    FileKind,
    FileRef,
    ResolvedFile,
)
from services.errors.file_grant import EndUserNotFoundError, GrantTtlTooLongError
from services.file_grant_service import MAX_SESSION_GRANT_TTL_SECONDS, FileGrantService


def _service() -> tuple[FileGrantService, MagicMock, MagicMock, MagicMock, MagicMock]:
    repository = MagicMock()
    repository.get_or_create_subject.return_value = "end-user-1"
    repository.subject_exists.return_value = True
    repository.resolve_owned_files.return_value = list[ResolvedFile | None]()
    files = MagicMock()
    tokens = MagicMock()
    tokens.issue_grant.return_value = ("grant", 1600)
    remote_files = MagicMock()
    service = FileGrantService(
        repository=repository,
        files=files,
        tokens=tokens,
        remote_files=remote_files,
        limits=FileGrantLimits(15, 10, 50, 100, 10, 5),
        now=lambda: 1000,
    )
    return service, repository, files, tokens, remote_files


def _mint_request(
    *,
    ttl_seconds: int = 600,
    file_refs: tuple[FileRef, ...] = (),
    optional_file_refs: tuple[FileRef, ...] = (),
) -> FileGrantMintRequest:
    return FileGrantMintRequest(
        tenant_id="tenant-1",
        app_id="app-1",
        subject="subject-1",
        is_anonymous=True,
        scopes=(FileGrantScope.UPLOAD,),
        ttl_seconds=ttl_seconds,
        file_refs=file_refs,
        optional_file_refs=optional_file_refs,
        run_deadline=None,
    )


def test_mint_rejects_an_invalid_ttl_before_persistence() -> None:
    service, repository, _files, tokens, _remote_files = _service()

    with pytest.raises(GrantTtlTooLongError):
        service.mint(_mint_request(ttl_seconds=MAX_SESSION_GRANT_TTL_SECONDS + 1))

    repository.get_or_create_subject.assert_not_called()
    tokens.issue_grant.assert_not_called()


def test_mint_orchestrates_identity_resolution_and_token_issuance() -> None:
    service, repository, _files, tokens, _remote_files = _service()

    result = service.mint(_mint_request())

    assert result.grant == "grant"
    repository.get_or_create_subject.assert_called_once()
    tokens.issue_grant.assert_called_once_with(
        context=FileGrantContext("tenant-1", "app-1", "end-user-1"),
        scopes=(FileGrantScope.UPLOAD,),
        ttl_seconds=600,
    )


def test_mint_resolves_required_and_optional_files_in_one_batch() -> None:
    service, repository, _files, tokens, _remote_files = _service()
    required_ref = FileRef(id="upload-1", kind=FileKind.UPLOAD)
    optional_ref = FileRef(id="tool-1", kind=FileKind.TOOL)
    required_file = ResolvedFile("upload-1", FileKind.UPLOAD, "report.pdf", 10, "pdf", "application/pdf")
    optional_file = ResolvedFile("tool-1", FileKind.TOOL, "chart.png", 20, "png", "image/png")
    repository.resolve_owned_files.return_value = [required_file, optional_file]
    tokens.issue_content_urls.return_value = ("https://files/tool-1", "http://files/tool-1")

    result = service.mint(
        _mint_request(
            file_refs=(required_ref,),
            optional_file_refs=(optional_ref,),
        )
    )

    repository.resolve_owned_files.assert_called_once_with(
        context=FileGrantContext("tenant-1", "app-1", "end-user-1"),
        refs=(required_ref, optional_ref),
    )
    assert result.files == (required_file,)
    assert result.optional_files[0] is not None
    assert result.optional_files[0].file == optional_file


def test_store_produced_rejects_a_deleted_subject_before_reading_the_file() -> None:
    service, repository, files, _tokens, _remote_files = _service()
    repository.subject_exists.return_value = False
    stream = BytesIO(b"produced content")

    with pytest.raises(EndUserNotFoundError):
        service.store_produced(
            context=FileGrantContext("tenant-1", "app-1", "deleted-user"),
            filename="result.txt",
            stream=stream,
            mimetype="text/plain",
        )

    assert stream.tell() == 0
    files.store_produced.assert_not_called()


def test_store_remote_upload_rejects_a_deleted_subject_before_fetching() -> None:
    service, repository, _files, _tokens, remote_files = _service()
    repository.subject_exists.return_value = False

    with pytest.raises(EndUserNotFoundError):
        service.store_remote_upload(
            context=FileGrantContext("tenant-1", "app-1", "deleted-user"),
            url="https://example.com/report.pdf",
        )

    remote_files.fetch.assert_not_called()


def test_resolve_rejects_a_deleted_subject_before_querying_files() -> None:
    service, repository, _files, _tokens, _remote_files = _service()
    repository.subject_exists.return_value = False

    with pytest.raises(EndUserNotFoundError):
        service.resolve_files(
            context=FileGrantContext("tenant-1", "app-1", "deleted-user"),
            refs=(),
        )

    repository.resolve_owned_files.assert_not_called()

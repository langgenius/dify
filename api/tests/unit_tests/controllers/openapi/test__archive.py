from __future__ import annotations

from io import BytesIO

import pytest
from werkzeug.datastructures import FileStorage

from controllers.openapi._archive import FolderRejections, build_folder_archive
from controllers.openapi._errors import ErrorDetail, OpenApiError, SkillPackageInvalid, SkillPackageTooLarge
from controllers.openapi._upload import UploadParts
from libs.archive_writer import ArchiveError, ArchiveLimits, ArchivePathReason

_REJECTIONS = FolderRejections("skill folder", SkillPackageInvalid, SkillPackageTooLarge)


def _folder(*paths: str) -> UploadParts:
    return {path: FileStorage(stream=BytesIO(b"x"), filename=path) for path in paths}


def _limits(max_entries: int = 10) -> ArchiveLimits:
    return ArchiveLimits(max_entries=max_entries, max_bytes=1_000_000)


def test_the_archive_lists_the_folder_paths_sorted() -> None:
    result = build_folder_archive(_folder("b.md", "a/c.md"), limits=_limits(), rejections=_REJECTIONS)

    assert [entry.path for entry in result.entries] == ["a/c.md", "b.md"]


@pytest.mark.parametrize(
    ("folder", "limits", "expected", "description", "details"),
    [
        (
            _folder("a.md", "b.md"),
            _limits(max_entries=1),
            SkillPackageTooLarge,
            "The skill folder has more than 1 files",
            None,
        ),
        (
            _folder("a\\b"),
            _limits(),
            SkillPackageInvalid,
            f"a\\b: {ArchivePathReason.UNSAFE_CHARACTER.message}",
            [
                ErrorDetail(
                    type=ArchivePathReason.UNSAFE_CHARACTER.value,
                    loc=["a\\b"],
                    msg=ArchivePathReason.UNSAFE_CHARACTER.message,
                )
            ],
        ),
        (_folder(".DS_Store"), _limits(), SkillPackageInvalid, "The skill folder has no files", None),
    ],
    ids=["over_a_limit", "unsafe_path", "only_junk"],
)
def test_a_rejected_folder_raises_the_callers_error(
    folder: UploadParts,
    limits: ArchiveLimits,
    expected: type[OpenApiError],
    description: str,
    details: list[ErrorDetail] | None,
) -> None:
    with pytest.raises(expected) as caught:
        build_folder_archive(folder, limits=limits, rejections=_REJECTIONS)

    assert (caught.value.description, caught.value.details) == (description, details)


class _UnknownArchiveError(ArchiveError):
    pass


def test_an_archive_error_the_rejections_do_not_know_is_reraised_unchanged() -> None:
    error = _UnknownArchiveError()

    with pytest.raises(_UnknownArchiveError) as caught:
        _REJECTIONS.of(error)

    assert caught.value is error

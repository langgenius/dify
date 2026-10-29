from __future__ import annotations

from io import BytesIO

import pytest
from werkzeug.datastructures import FileStorage

from controllers.openapi._archive import FolderRejections, build_folder_archive
from controllers.openapi._errors import SkillPackageInvalid, SkillPackageTooLarge
from controllers.openapi._upload import UploadParts
from libs.archive_writer import ArchiveLimits

_REJECTIONS = FolderRejections("skill folder", SkillPackageInvalid, SkillPackageTooLarge)


def _folder(*paths: str) -> UploadParts:
    return {path: FileStorage(stream=BytesIO(b"x"), filename=path) for path in paths}


def _limits(max_entries: int = 10) -> ArchiveLimits:
    return ArchiveLimits(max_entries=max_entries, max_bytes=1_000_000)


def test_the_archive_lists_the_folder_paths_sorted() -> None:
    result = build_folder_archive(_folder("b.md", "a/c.md"), limits=_limits(), rejections=_REJECTIONS)

    assert [entry.path for entry in result.entries] == ["a/c.md", "b.md"]


def test_a_folder_over_a_limit_is_too_large() -> None:
    with pytest.raises(SkillPackageTooLarge) as caught:
        build_folder_archive(_folder("a.md", "b.md"), limits=_limits(max_entries=1), rejections=_REJECTIONS)

    assert caught.value.description == "The skill folder has more than 1 files"


def test_an_unsafe_path_is_invalid_and_named() -> None:
    with pytest.raises(SkillPackageInvalid) as caught:
        build_folder_archive(_folder("a\\b"), limits=_limits(), rejections=_REJECTIONS)

    assert [detail.loc for detail in caught.value.details or []] == [["a\\b"]]


def test_a_folder_of_only_junk_has_no_files() -> None:
    with pytest.raises(SkillPackageInvalid) as caught:
        build_folder_archive(_folder(".DS_Store"), limits=_limits(), rejections=_REJECTIONS)

    assert caught.value.description == "The skill folder has no files"

from pathlib import Path

import pytest

from libs.file_utils import search_file_upwards


def test_search_file_upwards_found_in_parent(tmp_path: Path):
    base = tmp_path / "a" / "b" / "c"
    base.mkdir(parents=True)

    target = tmp_path / "a" / "target.txt"
    target.write_text("ok", encoding="utf-8")

    found = search_file_upwards(base, "target.txt", max_search_parent_depth=5)
    assert found == target


def test_search_file_upwards_found_in_current(tmp_path: Path):
    base = tmp_path / "x"
    base.mkdir()
    target = base / "here.txt"
    target.write_text("x", encoding="utf-8")

    found = search_file_upwards(base, "here.txt", max_search_parent_depth=1)
    assert found == target


def test_search_file_upwards_not_found_raises(tmp_path: Path):
    base = tmp_path / "m" / "n"
    base.mkdir(parents=True)
    with pytest.raises(ValueError) as exc:
        search_file_upwards(base, "missing.txt", max_search_parent_depth=3)
    # error message should contain file name and base path
    msg = str(exc.value)
    assert "missing.txt" in msg
    assert str(base) in msg


def test_search_file_upwards_root_breaks_and_raises():
    # Using filesystem root triggers the 'break' branch (parent == current)
    with pytest.raises(ValueError):
        search_file_upwards(Path("/"), "__definitely_not_exists__.txt", max_search_parent_depth=1)


def test_search_file_upwards_depth_limit_raises(tmp_path: Path):
    base = tmp_path / "a" / "b" / "c"
    base.mkdir(parents=True)
    target = tmp_path / "a" / "target.txt"
    target.write_text("ok", encoding="utf-8")
    # The file is 2 levels up from `c` (in `a`), but search depth is only 2.
    # The search path is `c` (depth 1) -> `b` (depth 2). The file is in `a` (would need depth 3).
    # So, this should not find the file and should raise an error.
    with pytest.raises(ValueError):
        search_file_upwards(base, "target.txt", max_search_parent_depth=2)

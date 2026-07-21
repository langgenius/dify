from __future__ import annotations

import pytest

from dify_agent.server.sandbox_files import SandboxFileError, normalize_workspace_path


@pytest.mark.parametrize("path", ["/etc/passwd", "../secret", "a/../../secret", "~", "~/secret"])
def test_workspace_file_paths_reject_escape_syntax(path: str) -> None:
    with pytest.raises(SandboxFileError, match="workspace"):
        normalize_workspace_path(path, allow_current_directory=True)


@pytest.mark.parametrize(("path", "expected"), [("", "."), ("./", "."), ("notes/a.txt", "notes/a.txt")])
def test_workspace_file_paths_preserve_relative_paths(path: str, expected: str) -> None:
    assert normalize_workspace_path(path, allow_current_directory=True) == expected

from __future__ import annotations

import ast
from pathlib import Path


def _repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "api" / "pyproject.toml").exists():
            return parent
    raise RuntimeError("repo root not found")


def test_approve_external_uses_compare_digest_for_csrf():
    src = (_repo_root() / "api" / "controllers" / "openapi" / "oauth_device_sso.py").read_text()
    tree = ast.parse(src)

    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "approve_external")
    fn_src = ast.unparse(fn)

    assert "compare_digest" in fn_src, "approve_external must call secrets.compare_digest for CSRF"
    assert "csrf_header != claims.csrf_token" not in fn_src, "approve_external must not use plain != on csrf_token"

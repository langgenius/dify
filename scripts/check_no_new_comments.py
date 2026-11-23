from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

EXTENSIONS = {
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".go",
    ".css",
    ".html",
    ".yml",
    ".yaml",
    ".json",
    ".sh",
    ".php",
}
GENERATED = ("packages/contracts/generated/", "web/public/vs/")
GENERATED_FILES = {
    "api/services/billing_client/billing.py",
    "api/services/billing_client/saas.py",
    "web/public/embed.min.js",
    "web/public/pdf.worker.min.mjs",
}
DIRECTIVE = re.compile(
    r"^(?:(?:eslint|oxlint|stylelint)-(?:disable|enable)(?:-next-line|-line)?\b|"
    r"ruff:\s*noqa\b|pylint:\s*(?:disable|enable)\b|(?:mypy|pyright|pyrefly|ty|tsslint):|pyrefly-ignore\b|"
    r"type:\s*ignore|noqa\b|nosec\b|pragma:\s*no\s*cover|"
    r"(?:v8|istanbul|c8)\s+ignore|@ts-(?:expect-error|ignore|check|nocheck)\b|"
    r"@jsx\b|@jsxImportSource\b|#__PURE__\b|@__PURE__\b|"
    r"go:|\+build\b|shellcheck\b|coding[:=]|-\*-.*coding[:=]|"
    r"ast-grep-ignore\b|@vite-ignore\b|webpack\w+:|"
    r"[\#@]\s*source(?:Mapping)?URL=|<reference\b)"
)
LEGAL = re.compile(
    r"\b(?:SPDX-License-Identifier|Copyright|Licensed under|Permission is hereby granted)\b",
    re.IGNORECASE,
)


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], check=True, capture_output=True).stdout


def in_scope(path: str) -> bool:
    return (
        Path(path).suffix in EXTENSIONS
        and path not in GENERATED_FILES
        and not path.startswith(GENERATED)
        and not path.endswith((".gen.ts", ".generated.ts"))
    )


def protected(text: str) -> bool:
    body = re.sub(r"^(?://+|/\*+|#+|<!--)\s*", "", text).strip()
    return bool(DIRECTIVE.match(body) or LEGAL.search(body))


def ast_grep() -> list[str]:
    if shutil.which("ast-grep"):
        return ["ast-grep"]
    if shutil.which("uvx"):
        return ["uvx", "--from", "ast-grep-cli==0.51.3", "ast-grep"]
    raise RuntimeError(
        "Install ast-grep 0.51.3 or uv before running the comment guard."
    )


def scan(root: Path, paths: list[str]) -> list[dict]:
    matches = []
    command = ast_grep()
    for start in range(0, len(paths), 150):
        result = subprocess.run(
            [
                *command,
                "run",
                "-k",
                "comment",
                "--json=compact",
                "--threads",
                "2",
                "--no-ignore",
                "hidden",
                "--no-ignore",
                "vcs",
                "--no-ignore",
                "dot",
                *paths[start : start + 150],
            ],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode not in (0, 1):
            raise RuntimeError(result.stderr or "Comment parser failed")
        batch = json.loads(result.stdout)
        if not isinstance(batch, list):
            raise TypeError("Invalid comment parser output")
        matches.extend(batch)
    return matches


def key(match: dict) -> str:
    return match["text"].replace("\r\n", "\n")


def additions(before: list[dict], after: list[dict]) -> list[dict]:
    budget = Counter(key(item) for item in before if not protected(item["text"]))
    violations = []
    for item in after:
        if not protected(item["text"]):
            identity = key(item)
            if budget[identity]:
                budget[identity] -= 1
            else:
                violations.append(item)
    return violations


def changed_versions(base: str, staged: bool) -> dict[str, tuple[bytes, bytes]]:
    args = (
        ("diff", "--cached", "--name-only", "-z", "--no-renames", "HEAD")
        if staged
        else ("diff", "--name-only", "-z", "--no-renames", base)
    )
    paths = [p for p in git(*args).decode().split("\0") if in_scope(p)]
    old_ref = "HEAD" if staged else base
    old_paths = set(
        git("ls-tree", "-r", "--name-only", "-z", old_ref).decode().split("\0")
    )
    new_paths = set(git("ls-files", "-z").decode().split("\0"))
    versions = {}
    for path in paths:
        old = git("show", f"{old_ref}:{path}") if path in old_paths else b""
        if staged:
            new = git("show", f":{path}") if path in new_paths else b""
        else:
            new = Path(path).read_bytes() if Path(path).is_file() else b""
        versions[path] = old, new
    return versions


def check(versions: dict[str, tuple[bytes, bytes]]) -> list[dict]:
    with tempfile.TemporaryDirectory(prefix="comment-guard-") as directory:
        root = Path(directory)
        for side in ("before", "after"):
            (root / side).mkdir()
        for path, sources in versions.items():
            for side, source in zip(("before", "after"), sources, strict=True):
                target = root / side / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source)
        before = scan(root / "before", list(versions))
        after = scan(root / "after", list(versions))
    violations = []
    for path in versions:
        violations.extend(
            additions(
                [m for m in before if m["file"] == path],
                [m for m in after if m["file"] == path],
            )
        )
    return violations


def inventory() -> dict:
    tracked = git("ls-files", "-z").decode().split("\0")
    paths = [
        p
        for p in tracked
        if in_scope(p) and Path(p).is_file() and not Path(p).is_symlink()
    ]
    matches = scan(Path.cwd(), paths)
    lines = {}
    for item in matches:
        if not protected(item["text"]):
            covered = lines.setdefault(item["file"], set())
            covered.update(
                range(item["range"]["start"]["line"], item["range"]["end"]["line"] + 1)
            )
    standalone = 0
    by_path = defaultdict(list)
    for item in matches:
        if not protected(item["text"]):
            by_path[item["file"]].append(item)
    for path, indexes in lines.items():
        source = Path(path).read_bytes()
        for item in sorted(
            by_path[path], key=lambda m: m["range"]["byteOffset"]["start"], reverse=True
        ):
            start = item["range"]["byteOffset"]["start"]
            end = item["range"]["byteOffset"]["end"]
            source = (
                source[:start]
                + re.sub(rb"[^\r\n]", b" ", source[start:end])
                + source[end:]
            )
        source_lines = source.splitlines()
        standalone += sum(not source_lines[i].strip() for i in indexes)
    return {
        "revision": git("rev-parse", "HEAD").decode().strip(),
        "files_scanned": len(paths),
        "comments": len(matches),
        "protected_comments": sum(protected(m["text"]) for m in matches),
        "ordinary_comment_lines": sum(map(len, lines.values())),
        "removable_comment_only_lines": standalone,
        "languages": dict(Counter(m["language"] for m in matches)),
        "unscanned_extensions": dict(
            Counter(
                Path(p).suffix or "<none>" for p in tracked if p and not in_scope(p)
            )
        ),
        "entries": [
            {
                "path": m["file"],
                "line": m["range"]["start"]["line"] + 1,
                "text": m["text"],
                "category": None,
                "status": "protected" if protected(m["text"]) else "pending-review",
            }
            for m in matches
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reject new explanatory comments against a Git baseline."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--base-rev")
    mode.add_argument("--staged", action="store_true")
    mode.add_argument("--inventory", metavar="OUTPUT_JSON")
    args = parser.parse_args()
    try:
        if args.inventory:
            result = inventory()
            Path(args.inventory).write_text(
                json.dumps(result, indent=2, ensure_ascii=False) + "\n"
            )
            print(
                json.dumps(
                    {k: v for k, v in result.items() if k != "entries"}, indent=2
                )
            )
            return 0
        violations = check(changed_versions(args.base_rev, args.staged))
        for item in violations:
            print(
                f"{item['file']}:{item['range']['start']['line'] + 1}: no-new-comments: delete redundant/stale prose, file an issue for workarounds, or record the decision in docs/adr/."
            )
        return int(bool(violations))
    except (
        OSError,
        RuntimeError,
        ValueError,
        TypeError,
        subprocess.CalledProcessError,
    ) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

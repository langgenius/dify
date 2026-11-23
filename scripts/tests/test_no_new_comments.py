from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_no_new_comments import (
    additions,
    changed_versions,
    check,
    inventory,
    protected,
    scan,
)


class CommentGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def parse(self, name, source):
        (self.root / name).write_text(source)
        return scan(self.root, [name])

    def test_parser_distinguishes_literals_regex_and_jsx_comments(self):
        matches = self.parse(
            "source.tsx",
            'const url = "https://example.com"; const re = /a\\/\\/b/; const t = `// data`; const x = <div>{/* rationale */}</div>; // prose\n',
        )
        self.assertEqual([m["text"] for m in matches], ["/* rationale */", "// prose"])

    def test_python_runtime_strings_and_docstrings_are_not_comments(self):
        matches = self.parse(
            "source.py", '"""Contract docs."""\nvalue = "# data"  # explanatory\n'
        )
        self.assertEqual([m["text"] for m in matches], ["# explanatory"])

    def test_all_supported_grammars(self):
        cases = {
            "a.ts": "// prose\nconst a = 1",
            "a.js": "// prose\nconst a = 1",
            "a.jsx": "const a = <div>{/* prose */}</div>",
            "a.mjs": "// prose\nexport {}",
            "a.cjs": "// prose\nmodule.exports = {}",
            "a.go": "package a\n// prose\nvar a = 1",
            "a.css": "/* prose */\na {color: red}",
            "a.html": "<!-- prose --><div></div>",
            "a.yml": 'value: "# data" # prose\n',
            "a.yaml": "# prose\nvalue: 1",
            "a.json": '{"value": 1 /* prose */}',
            "a.sh": 'echo "# data" # prose\n',
            "a.php": "<?php /* prose */ $a = 1;",
        }
        for name, source in cases.items():
            with self.subTest(name=name):
                self.assertEqual(len(self.parse(name, source)), 1)

    def test_per_file_text_and_occurrence_ratchet(self):
        before = self.parse("a.ts", "// legacy\nconst a = 1\n")
        moved = self.parse("a.ts", "\n\n// legacy\nconst a = 1\n")
        self.assertEqual(additions(before, moved), [])
        doubled = self.parse("a.ts", "// legacy\n// legacy\n")
        self.assertEqual(len(additions(before, doubled)), 1)
        edited = self.parse("a.ts", "// different\n")
        self.assertEqual(len(additions(before, edited)), 1)
        self.assertEqual(additions(before, []), [])
        violations = check(
            {"a.ts": (b"// legacy\n", b""), "b.ts": (b"", b"// legacy\n")}
        )
        self.assertEqual([v["file"] for v in violations], ["b.ts"])

    def test_preserves_directives_and_legal_notices(self):
        for text in (
            "// oxlint-disable-next-line no-alert -- reason",
            "# noqa: E501",
            "// @ts-expect-error reason",
            "/* v8 ignore next 2 */",
            "//go:generate tool",
            "/*#__PURE__*/",
            "// Copyright 2026 Example",
            "/* SPDX-License-Identifier: MIT */",
            "// @vite-ignore",
            '/// <reference types="vite/client" />',
        ):
            with self.subTest(text=text):
                self.assertTrue(protected(text))
        self.assertFalse(protected("// Ignore this hack for now"))
        self.assertFalse(protected("// explains eslint configuration"))
        self.assertFalse(protected("// type is string"))
        self.assertFalse(protected("// temporary workaround"))

    def test_missing_parser_fails_closed(self):
        with (
            patch("check_no_new_comments.shutil.which", return_value=None),
            self.assertRaises(RuntimeError),
        ):
            scan(self.root, ["a.ts"])

    def test_parser_command_failure_fails_closed(self):
        result = subprocess.CompletedProcess([], 2, stdout="", stderr="broken parser")
        with (
            patch("check_no_new_comments.subprocess.run", return_value=result),
            self.assertRaisesRegex(RuntimeError, "broken parser"),
        ):
            scan(self.root, ["a.ts"])

    def test_git_index_diff_and_line_estimate(self):
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)

        def git(*args):
            return subprocess.run(
                ["git", *args], check=True, capture_output=True
            ).stdout.decode()

        git("init", "-q")
        git("config", "user.name", "Comment guard test")
        git("config", "user.email", "comment-test@example.com")
        Path("a.ts").write_text(
            "// legacy\nconst a = 1 // mixed\n/* multi\n * line */\n"
        )
        Path("a.py").write_text('"""Runtime contract."""\n# one\n')
        git("add", ".")
        git("commit", "-qm", "baseline")
        base = git("rev-parse", "HEAD").strip()
        result = inventory()
        self.assertEqual(result["removable_comment_only_lines"], 4)
        self.assertEqual(result["ordinary_comment_lines"], 5)
        self.assertTrue(all(m["category"] is None for m in result["entries"]))
        Path("a.ts").write_text("const a = 1 // mixed\n")
        self.assertEqual(check(changed_versions(base, False)), [])
        Path("new.ts").write_text("// new\n")
        git("add", ".")
        Path("new.ts").write_text("const noComment = 1\n")
        self.assertEqual(len(check(changed_versions(base, True))), 1)
        self.assertEqual(check(changed_versions(base, False)), [])
        git("rm", "--cached", "-f", "new.ts")
        self.assertEqual(check(changed_versions(base, True)), [])
        git("commit", "-qm", "remove legacy comments")
        Path("a.ts").write_text("// legacy\nconst a = 1 // mixed\n")
        self.assertEqual(len(check(changed_versions("HEAD", False))), 1)


if __name__ == "__main__":
    unittest.main()

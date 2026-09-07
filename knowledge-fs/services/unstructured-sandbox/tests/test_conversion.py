import concurrent.futures
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from kfs_sandbox.admission import Budget, Limits, Rejected
from kfs_sandbox.conversion import (
    convert,
    initialize_budget,
    load_budget,
    parse_invocation,
)
from kfs_sandbox.converter_cli import run as run_cli, main as cli_main
from tests.test_admission import archive


FAKE = [sys.executable, str(Path(__file__).with_name("fake_converter.py"))]


class ConversionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="kfs-conversion-test-")
        self.directory = Path(self.temporary.name)
        initialize_budget(self.directory, Budget(), wall_seconds=5)

    def tearDown(self):
        self.temporary.cleanup()

    def source(self, name, body):
        path = self.directory / name
        path.write_bytes(body)
        return path

    def invoke(self, kind, args, **kwargs):
        stdout, stderr = io.BytesIO(), io.BytesIO()
        code = convert(kind, args, self.directory, FAKE, stdout, stderr, **kwargs)
        return code, stdout.getvalue(), stderr.getvalue()

    def test_soffice_output_is_validated_then_published_without_changing_success_output(
        self,
    ):
        original = archive({"word/document.xml": "<document>evidence</document>"})
        source = self.source("sample.doc", original)
        result = self.invoke(
            "soffice",
            [
                "--headless",
                "--convert-to",
                "docx:MS Word 2007 XML",
                "--outdir",
                str(self.directory),
                str(source),
            ],
        )
        self.assertEqual(result, (0, b"Converted fixture\n", b""))
        self.assertEqual((self.directory / "sample.docx").read_bytes(), original)
        self.assertEqual(load_budget(self.directory)[0].archive_entries, 1)

    def test_unsafe_generated_office_file_is_never_published(self):
        source = self.source(
            "sample.ppt",
            archive({"a.xml": '<worksheet><c r="XFD1048576"/></worksheet>'}),
        )
        with self.assertRaisesRegex(Rejected, "sheet_extent"):
            self.invoke(
                "soffice",
                [
                    "--headless",
                    "--convert-to",
                    "pptx",
                    "--outdir",
                    str(self.directory),
                    str(source),
                ],
            )
        self.assertFalse((self.directory / "sample.pptx").exists())
        self.assertEqual(load_budget(self.directory)[1], "sheet_extent")

    def test_pandoc_html_stdout_is_unchanged_but_released_only_after_admission(self):
        body = b"<p>Evidence &amp; reference</p><img src='x'>"
        source = self.source("sample.rtf", body)
        result = self.invoke(
            "pandoc", ["--from=rtf", "--to=html", str(source), "--sandbox"]
        )
        self.assertEqual(result, (0, body, b""))
        self.assertGreater(load_budget(self.directory)[0].xml_nodes, 0)

    def test_pandoc_generated_docx_file_uses_shared_budget(self):
        initialize_budget(
            self.directory, Budget(Limits(xml_nodes=2), xml_nodes=2), wall_seconds=5
        )
        source = self.source(
            "sample.odt", archive({"word/document.xml": "<document/>"})
        )
        target = self.directory / "sample.docx"
        with self.assertRaisesRegex(Rejected, "xml_nodes"):
            self.invoke(
                "pandoc",
                [
                    "--from=odt",
                    "--to=docx",
                    str(source),
                    f"--output={target}",
                    "--sandbox",
                ],
            )
        self.assertFalse(target.exists())

    def test_html_depth_and_table_expansion_are_checked_before_stdout_release(self):
        for body, limits, reason in (
            (b"<div><div><p>x</p></div></div>", Limits(xml_depth=2), "xml_depth"),
            (
                b"<table><tr><td colspan='999999'>x</td></tr></table>",
                Limits(),
                "sheet_extent",
            ),
        ):
            initialize_budget(self.directory, Budget(limits), wall_seconds=5)
            source = self.source("sample.rtf", body)
            stdout = io.BytesIO()
            with self.assertRaisesRegex(Rejected, reason):
                convert(
                    "pandoc",
                    ["--from=rtf", "--to=html", str(source)],
                    self.directory,
                    FAKE,
                    stdout,
                    io.BytesIO(),
                )
            self.assertEqual(stdout.getvalue(), b"")

    def test_concurrent_conversions_cannot_double_spend_shared_budget(self):
        initialize_budget(self.directory, Budget(Limits(xml_nodes=1)), wall_seconds=5)
        sources = [self.source(f"{index}.rtf", b"<p>x</p>") for index in range(2)]

        def attempt(source):
            try:
                self.invoke("pandoc", ["--from=rtf", "--to=html", str(source)])
                return "passed"
            except Rejected:
                return "rejected"

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(attempt, sources)), ["passed", "rejected"])
        self.assertEqual(load_budget(self.directory)[0].xml_nodes, 1)

    def test_unknown_flags_and_paths_outside_request_directory_fail_before_execution(
        self,
    ):
        source = self.source("sample.rtf", b"<p>x</p>")
        for args in (
            ["--from=rtf", "--to=html", str(source), "--lua-filter=bad.lua"],
            ["--from=rtf", "--to=html", "/etc/passwd"],
            ["--from=odt", "--to=docx", str(source), "--output=/tmp/outside.docx"],
        ):
            with self.assertRaisesRegex(Rejected, "archive_path|archive_invalid"):
                parse_invocation("pandoc", args, self.directory)

    def test_existing_output_is_not_overwritten(self):
        source = self.source("sample.doc", archive({"a.xml": "<r/>"}))
        target = self.source("sample.docx", b"existing")
        with self.assertRaisesRegex(Rejected, "archive_path"):
            self.invoke(
                "soffice",
                [
                    "--headless",
                    "--convert-to",
                    "docx",
                    "--outdir",
                    str(self.directory),
                    str(source),
                ],
            )
        self.assertEqual(target.read_bytes(), b"existing")

    def test_concurrent_output_creation_cannot_be_overwritten_after_validation(self):
        source = self.source("sample.doc", archive({"a.xml": "<r/>"}))
        with patch.dict(os.environ, {"KFS_FAKE_CONVERTER_MODE": "collision"}):
            with self.assertRaisesRegex(Rejected, "archive_path"):
                self.invoke(
                    "soffice",
                    [
                        "--headless",
                        "--convert-to",
                        "docx",
                        "--outdir",
                        str(self.directory),
                        str(source),
                    ],
                )
        self.assertEqual(
            (self.directory / "sample.docx").read_bytes(), b"concurrent output"
        )

    def test_converter_nonzero_status_and_stderr_are_preserved(self):
        source = self.source("sample.rtf", b"body")
        with patch.dict(os.environ, {"KFS_FAKE_CONVERTER_MODE": "error"}):
            self.assertEqual(
                self.invoke("pandoc", ["--from=rtf", "--to=html", str(source)]),
                (42, b"", b"converter failed"),
            )
        self.assertIsNone(load_budget(self.directory)[1])

    def test_converter_signal_termination_is_sticky_and_never_publishes_output(self):
        source = self.source("sample.doc", archive({"a.xml": "<r/>"}))
        with patch.dict(os.environ, {"KFS_FAKE_CONVERTER_MODE": "signal"}):
            with self.assertRaisesRegex(Rejected, "worker_resource_limit"):
                self.invoke(
                    "soffice",
                    [
                        "--headless",
                        "--convert-to",
                        "docx",
                        "--outdir",
                        str(self.directory),
                        str(source),
                    ],
                )
        self.assertFalse((self.directory / "sample.docx").exists())
        self.assertEqual(load_budget(self.directory)[1], "worker_resource_limit")

    def test_missing_symlink_or_oversized_generated_file_is_not_published(self):
        source = self.source("sample.doc", archive({"a.xml": "<r/>"}))
        for mode, cap, reason in (
            ("missing", 1024, "archive_invalid"),
            ("symlink", 1024, "archive_invalid"),
            ("", 10, "xml_member_bytes"),
        ):
            initialize_budget(self.directory, Budget(), wall_seconds=5)
            with (
                self.subTest(mode=mode),
                patch.dict(os.environ, {"KFS_FAKE_CONVERTER_MODE": mode}),
            ):
                with self.assertRaisesRegex(Rejected, reason):
                    self.invoke(
                        "soffice",
                        [
                            "--headless",
                            "--convert-to",
                            "docx",
                            "--outdir",
                            str(self.directory),
                            str(source),
                        ],
                        max_product_bytes=cap,
                    )
            self.assertFalse((self.directory / "sample.docx").exists())

    def test_stdout_is_bounded_before_loading_or_forwarding(self):
        source = self.source("sample.rtf", b"body")
        with patch.dict(os.environ, {"KFS_FAKE_CONVERTER_MODE": "large"}):
            with self.assertRaisesRegex(Rejected, "xml_member_bytes"):
                self.invoke(
                    "pandoc",
                    ["--from=rtf", "--to=html", str(source)],
                    max_product_bytes=100,
                )

    def test_version_and_format_probes_preserve_upstream_discovery(self):
        result = self.invoke("pandoc", ["--version"])
        self.assertEqual(result, (0, b"pandoc 3.9\n", b""))
        self.assertEqual(load_budget(self.directory)[0].xml_nodes, 0)

    def test_invocation_contract_rejects_unrecognized_shapes(self):
        source = self.source("a.rtf", b"body")
        cases = [
            ("unknown", []),
            ("soffice", []),
            (
                "soffice",
                [
                    "--headless",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    str(self.directory),
                    str(source),
                ],
            ),
            ("pandoc", ["--from=rtf", "--to=html", "--from=rtf", str(source)]),
            ("pandoc", ["--from=", "--to=html", str(source)]),
            ("pandoc", ["--from=rtf", "--to=html", str(source), str(source)]),
            (
                "pandoc",
                ["--from=rtf", "--to=html", str(source), "--sandbox", "--sandbox"],
            ),
            ("pandoc", ["--from=rtf", "--to=docx", str(source)]),
        ]
        for kind, args in cases:
            with self.subTest(kind=kind, args=args), self.assertRaises(Rejected):
                parse_invocation(kind, args, self.directory)

    def test_symlink_and_directory_inputs_are_not_followed(self):
        source = self.source("sample.rtf", b"body")
        link = self.directory / "linked.rtf"
        link.symlink_to(source)
        for path in (link, self.directory):
            with self.assertRaisesRegex(Rejected, "archive_path"):
                parse_invocation(
                    "pandoc", ["--from=rtf", "--to=html", str(path)], self.directory
                )

    def test_html_rowspans_and_self_closing_tags_preserve_bounded_geometry(self):
        body = b"<div><img/><table><tr><td rowspan='2'>a</td><td>b</td></tr><tr><td>c</td></tr><tr><td>d</td></tr></table><hr/></div></unknown>"
        source = self.source("sample.rtf", body)
        self.assertEqual(
            self.invoke("pandoc", ["--from=rtf", "--to=html", str(source)])[1], body
        )
        self.assertEqual(load_budget(self.directory)[0].workbook_cells, 6)

    def test_html_invalid_spans_duplicates_bytes_and_rectangles_are_rejected(self):
        cases = [
            (
                b"<table><tr><td rowspan='0'>x</td></tr></table>",
                Limits(),
                "sheet_extent",
            ),
            (
                b"<table><tr><td colspan='2' colspan='1'>x</td></tr></table>",
                Limits(),
                "archive_invalid",
            ),
            (
                b"<table><tr><td rowspan='10' colspan='10'>x</td></tr></table>",
                Limits(sheet_cells=99),
                "sheet_cells",
            ),
            (
                b"<table><tr><td rowspan='100001'>x</td></tr></table>",
                Limits(),
                "sheet_extent",
            ),
            (b"<p>x</p>", Limits(xml_member_bytes=2), "xml_member_bytes"),
            (b"\xff", Limits(), "archive_invalid"),
        ]
        for body, limits, reason in cases:
            initialize_budget(self.directory, Budget(limits), wall_seconds=5)
            source = self.source("sample.rtf", body)
            with self.assertRaisesRegex(Rejected, reason):
                self.invoke("pandoc", ["--from=rtf", "--to=html", str(source)])

    def test_converter_deadline_kills_the_external_process(self):
        initialize_budget(self.directory, Budget(), wall_seconds=0.05)
        source = self.source("sample.rtf", b"body")
        with patch.dict(os.environ, {"KFS_FAKE_CONVERTER_MODE": "wait"}):
            with self.assertRaisesRegex(Rejected, "wall_seconds"):
                self.invoke("pandoc", ["--from=rtf", "--to=html", str(source)])

    def test_rejected_budget_prevents_later_converter_launch(self):
        initialize_budget(
            self.directory, Budget(Limits(xml_nodes=1), xml_nodes=1), wall_seconds=5
        )
        source = self.source("sample.rtf", b"<p>x</p>")
        for _ in range(2):
            with self.assertRaisesRegex(Rejected, "xml_nodes"):
                self.invoke("pandoc", ["--from=rtf", "--to=html", str(source)])

    def test_cli_preserves_probes_and_maps_known_rejection_to_nonzero(self):
        executable = self.directory / "fake-converter"
        shutil.copyfile(FAKE[1], executable)
        executable.chmod(0o700)
        manifest = self.directory / "manifest.json"
        manifest.write_text(
            json.dumps({"pandoc": str(executable), "soffice": str(executable)})
        )
        output, errors = io.BytesIO(), io.BytesIO()
        self.assertEqual(
            run_cli("pandoc", ["--version"], self.directory, manifest, output, errors),
            0,
        )
        self.assertEqual(output.getvalue(), b"pandoc 3.9\n")
        source = self.source("sample.doc", b"invalid archive")
        self.assertEqual(
            run_cli(
                "soffice",
                [
                    "--headless",
                    "--convert-to",
                    "docx",
                    "--outdir",
                    str(self.directory),
                    str(source),
                ],
                self.directory,
                manifest,
                output,
                errors,
            ),
            65,
        )
        self.assertIn(b"admission rejected", errors.getvalue())

    def test_cli_rejects_invalid_manifest_instead_of_using_path_fallback(self):
        manifest = self.source("manifest.json", b"x" * 4097)
        with self.assertRaisesRegex(RuntimeError, "manifest"):
            run_cli(
                "pandoc",
                ["--version"],
                self.directory,
                manifest,
                io.BytesIO(),
                io.BytesIO(),
            )
        manifest.write_text(json.dumps({"pandoc": "relative"}))
        with self.assertRaisesRegex(RuntimeError, "executable"):
            run_cli(
                "pandoc",
                ["--version"],
                self.directory,
                manifest,
                io.BytesIO(),
                io.BytesIO(),
            )

    def test_cli_main_never_prints_sensitive_exception_details(self):
        errors = io.StringIO()
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("kfs_sandbox.converter_cli.sys.stderr", errors),
        ):
            with self.assertRaises(SystemExit) as stopped:
                cli_main("pandoc")
        self.assertEqual(stopped.exception.code, 70)
        self.assertEqual(
            errors.getvalue(), "KnowledgeFS converter runtime is unavailable\n"
        )


if __name__ == "__main__":
    unittest.main()

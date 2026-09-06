"""Small, bounded document fixtures: never send a decompression bomb to a parser."""

import io
import unittest
import zipfile
import hashlib
from pathlib import Path
from unittest.mock import MagicMock, patch
from types import SimpleNamespace
from email.message import EmailMessage

from kfs_sandbox.admission import (
    Budget,
    Limits,
    Rejected,
    inspect_document,
    _is_outlook_storage,
    _msg_attachments,
)


def archive(parts):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as handle:
        for name, body in parts.items():
            handle.writestr(name, body)
    return output.getvalue()


def message(attachments=()):
    value = EmailMessage()
    value["Subject"] = "Fixture"
    value.set_content("Searchable message body")
    for filename, body in attachments:
        value.add_attachment(
            body, maintype="application", subtype="octet-stream", filename=filename
        )
    return value.as_bytes()


class AdmissionTests(unittest.TestCase):
    def test_pinned_public_msg_fixture_is_admitted_with_real_oxmsg_reader(self):
        fixture = (
            Path(__file__).resolve().parents[1] / "fixtures/fake-email-attachment.msg"
        )
        body = fixture.read_bytes()
        self.assertEqual(
            hashlib.sha256(body).hexdigest(),
            "92f65236e7eae301ea6f70a85f38cd5a9fae9f807d17fc35c5b5dbcf0f82a8ec",
        )
        for name in ("fixture.msg", "renamed.xls"):
            budget = inspect_document(body, name)
            self.assertEqual(budget.attachments, 1)
            self.assertEqual(budget.decoded_bytes, 30)

    def test_plain_mail_remains_accepted(self):
        budget = inspect_document(message(), "sample.eml")
        self.assertEqual(budget.attachments, 0)

    def test_attachment_count_is_shared_across_nested_messages(self):
        nested = message([("a.txt", b"A"), ("b.txt", b"B")])
        with self.assertRaisesRegex(Rejected, "attachments"):
            inspect_document(
                message([("nested.eml", nested)]),
                "outer.eml",
                Budget(Limits(attachments=2)),
            )

    def test_attachment_bytes_are_aggregate_not_per_file(self):
        with self.assertRaisesRegex(Rejected, "decoded_bytes"):
            inspect_document(
                message([("a.txt", b"123"), ("b.txt", b"456")]),
                "a.eml",
                Budget(Limits(decoded_bytes=5)),
            )

    def test_mime_depth_is_bounded(self):
        nested = message([("a.eml", message([("b.eml", message())]))])
        with self.assertRaisesRegex(Rejected, "depth"):
            inspect_document(nested, "outer.eml", Budget(Limits(depth=1)))

    def test_unknown_attachments_are_explicitly_rejected_not_silently_skipped(self):
        with self.assertRaisesRegex(Rejected, "unsupported_attachment"):
            inspect_document(message([("program.exe", b"MZ\x00")]), "a.eml")

    def test_nested_xlsx_sparse_extent_is_rejected_before_partition(self):
        xlsx = archive(
            {
                "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c r="A1"/><c r="XFD1048576"/></row></sheetData></worksheet>'
            }
        )
        with self.assertRaisesRegex(Rejected, "sheet_"):
            inspect_document(message([("sheet.xlsx", xlsx)]), "a.eml")

    def test_zip_budget_is_shared_between_attachments(self):
        payload = archive({"word/document.xml": "<document>abcdef</document>"})
        with self.assertRaisesRegex(Rejected, "expanded_bytes"):
            inspect_document(
                message([("a.docx", payload), ("b.docx", payload)]),
                "a.eml",
                Budget(Limits(expanded_bytes=40)),
            )

    def test_xml_entities_are_rejected(self):
        docx = archive(
            {"word/document.xml": '<!DOCTYPE r [<!ENTITY x "boom">]><r>&x;</r>'}
        )
        with self.assertRaisesRegex(Rejected, "xml_entity"):
            inspect_document(docx, "a.docx")

    def test_unsafe_zip_path_is_rejected(self):
        with self.assertRaisesRegex(Rejected, "archive_path"):
            inspect_document(archive({"../outside.xml": "<r/>"}), "a.docx")

    def test_zip_extension_spoofing_does_not_bypass_inspection(self):
        with self.assertRaisesRegex(Rejected, "sheet_"):
            inspect_document(
                archive(
                    {
                        "xl/worksheets/sheet1.xml": '<worksheet><c r="XFD1048576"/></worksheet>'
                    }
                ),
                "a.txt",
            )

    def test_safe_archive_and_mime_parts_preserve_a_shared_report(self):
        payload = archive({"word/document.xml": "<document>ordinary</document>"})
        budget = inspect_document(message([("report.docx", payload)]), "sample.eml")
        self.assertEqual(budget.attachments, 1)
        self.assertEqual(budget.archive_entries, 1)
        self.assertEqual(budget.expanded_bytes, 29)

    def test_msg_attachments_use_the_same_recursive_budget(self):
        attachments = [("nested.eml", message([("a.txt", b"A")]))]
        with self.assertRaisesRegex(Rejected, "attachments"):
            inspect_document(
                b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
                "a.msg",
                Budget(Limits(attachments=1)),
                msg_loader=lambda _: attachments,
            )

    def test_invalid_zip_is_a_stable_input_error(self):
        with self.assertRaisesRegex(Rejected, "archive_invalid"):
            inspect_document(b"PK\x03\x04broken", "a.docx")

    def test_xml_and_sheet_limits_apply_across_members(self):
        with self.assertRaisesRegex(Rejected, "sheets"):
            inspect_document(
                archive({"a.xml": "<worksheet/>", "b.xml": "<worksheet/>"}),
                "a.docx",
                Budget(Limits(sheets=1)),
            )
        with self.assertRaisesRegex(Rejected, "xml_depth"):
            inspect_document(
                archive({"a.xml": "<a><b><c/></b></a>"}),
                "a.docx",
                Budget(Limits(xml_depth=2)),
            )
        with self.assertRaisesRegex(Rejected, "xml_nodes"):
            inspect_document(
                archive({"a.xml": "<a><b/><b/></a>"}),
                "a.docx",
                Budget(Limits(xml_nodes=2)),
            )
        with self.assertRaisesRegex(Rejected, "xml_bytes"):
            inspect_document(
                archive({"a.xml": "<a/>"}), "a.docx", Budget(Limits(xml_bytes=2))
            )
        with self.assertRaisesRegex(Rejected, "xml_member_bytes"):
            inspect_document(
                archive({"a.xml": "<a/>"}), "a.docx", Budget(Limits(xml_member_bytes=2))
            )

    def test_cell_shape_and_logical_span_are_bounded(self):
        with self.assertRaisesRegex(Rejected, "sheet_cell_reference"):
            inspect_document(
                archive({"a.xml": '<worksheet><c r="broken"/></worksheet>'}), "a.xlsx"
            )
        with self.assertRaisesRegex(Rejected, "sheet_cells"):
            inspect_document(
                archive({"a.xml": '<worksheet><mergeCell ref="A1:Z999"/></worksheet>'}),
                "a.xlsx",
                Budget(Limits(sheet_cells=100)),
            )
        with self.assertRaisesRegex(Rejected, "workbook_cells"):
            inspect_document(
                archive(
                    {
                        "a.xml": '<worksheet><c r="B2"/></worksheet>',
                        "b.xml": '<worksheet><c r="B2"/></worksheet>',
                    }
                ),
                "a.xlsx",
                Budget(Limits(workbook_cells=7)),
            )

    def test_msg_failure_is_sanitized(self):
        def broken(_):
            raise ValueError("Secret document text")

        with self.assertRaisesRegex(Rejected, "^msg_invalid$"):
            inspect_document(b"bad", "a.msg", msg_loader=broken)

    def test_archive_entry_count_is_bounded(self):
        with self.assertRaisesRegex(Rejected, "archive_entries"):
            inspect_document(
                archive({"one.bin": "1", "two.bin": "2"}),
                "a.docx",
                Budget(Limits(archive_entries=1)),
            )

    def test_renamed_mail_still_has_nested_budget(self):
        with self.assertRaisesRegex(Rejected, "attachments"):
            inspect_document(
                message([("a.txt", b"A"), ("b.txt", b"B")]),
                "sample.txt",
                Budget(Limits(attachments=1)),
            )

    def test_rfc822_attachments_and_mime_part_count_are_bounded(self):
        outer = EmailMessage()
        outer["Subject"] = "RFC822"
        outer.set_content("Body")
        nested = EmailMessage()
        nested.set_content("Nested body")
        outer.add_attachment(nested)
        self.assertEqual(inspect_document(outer.as_bytes(), "a.eml").attachments, 1)
        with self.assertRaisesRegex(Rejected, "mime_parts"):
            inspect_document(outer.as_bytes(), "a.eml", Budget(Limits(mime_parts=2)))

    def test_implicit_xlsx_cell_positions_are_valid_and_still_bounded(self):
        payload = archive({"a.xml": '<worksheet><row r="2"><c/><c/></row></worksheet>'})
        budget = inspect_document(payload, "a.xlsx")
        self.assertEqual(budget.workbook_cells, 4)
        with self.assertRaisesRegex(Rejected, "sheet_cells"):
            inspect_document(payload, "a.xlsx", Budget(Limits(sheet_cells=3)))

    def test_msg_content_signature_wins_over_a_legacy_office_filename(self):
        with patch("kfs_sandbox.admission._is_outlook_storage", return_value=True):
            with self.assertRaisesRegex(Rejected, "attachments"):
                inspect_document(
                    b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
                    "disguised.xls",
                    Budget(Limits(attachments=1)),
                    msg_loader=lambda _: [("a.txt", b"a"), ("b.txt", b"b")],
                )

    def test_msg_reader_contract_and_ole_signature_diagnostics(self):
        msg = SimpleNamespace(
            Message=SimpleNamespace(
                load=lambda _: SimpleNamespace(
                    attachments=[
                        SimpleNamespace(file_name="a.txt", file_bytes=b"A"),
                        SimpleNamespace(file_name=None, file_bytes=None),
                    ]
                )
            )
        )
        with patch.dict("sys.modules", {"oxmsg": msg}):
            self.assertEqual(
                list(_msg_attachments(b"fixture")), [("a.txt", b"A"), ("unknown", b"")]
            )
        handle = MagicMock()
        handle.__enter__.return_value.exists.return_value = True
        with patch.dict(
            "sys.modules", {"olefile": SimpleNamespace(OleFileIO=lambda _: handle)}
        ):
            self.assertTrue(_is_outlook_storage(b"fixture"))

        def invalid(_):
            raise OSError("unsafe details")

        with patch.dict("sys.modules", {"olefile": SimpleNamespace(OleFileIO=invalid)}):
            with self.assertRaisesRegex(Rejected, "^ole_invalid$"):
                _is_outlook_storage(b"fixture")

    def test_archive_binary_members_are_counted_and_encryption_rejected(self):
        payload = archive({"media/image.bin": b"bytes"})
        self.assertEqual(inspect_document(payload, "a.docx").expanded_bytes, 5)
        encrypted = bytearray(payload)
        encrypted[6] |= 1
        encrypted[encrypted.index(b"PK\x01\x02") + 8] |= 1
        with self.assertRaisesRegex(Rejected, "archive_encrypted"):
            inspect_document(bytes(encrypted), "a.docx")

    def test_invalid_mime_and_implicit_row_extents_are_rejected(self):
        with self.assertRaisesRegex(Rejected, "mime_invalid"):
            inspect_document(
                b"MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=missing\r\n\r\nbody",
                "a.eml",
            )
        with self.assertRaisesRegex(Rejected, "sheet_extent"):
            inspect_document(
                archive({"a.xml": '<worksheet><row r="999999"/></worksheet>'}), "a.xlsx"
            )


if __name__ == "__main__":
    unittest.main()

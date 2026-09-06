import importlib.util
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "sandbox_golden", Path(__file__).resolve().parents[1] / "golden.py"
)
golden = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(golden)


class GoldenTests(unittest.TestCase):
    def test_default_msg_fixture_is_version_pinned_and_requires_attachment_content(
        self,
    ):
        body, marker = golden.msg_fixture(None)
        self.assertEqual(len(body), 15872)
        self.assertEqual(marker, "Hey this is a fake attachment!")

    def test_pdf_fixture_has_bounded_geometry_and_valid_xref(self):
        body = golden.pdf_fixture()
        self.assertIn(b"/MediaBox [0 0 300 200]", body)
        self.assertIn(golden.MARKER.encode(), body)
        startxref = int(body.split(b"startxref\n")[1].splitlines()[0])
        self.assertEqual(body[startxref : startxref + 4], b"xref")
        self.assertLess(len(body), 1024)

    def test_multipart_preserves_document_and_declares_strategy(self):
        body, content_type = golden.multipart("a.txt", b"example")
        self.assertIn(b'filename="a.txt"', body)
        self.assertIn(b"example", body)
        self.assertIn(b"fast", body)
        self.assertIn("boundary=", content_type)

    def test_real_provider_content_failure_cannot_be_reported_as_pass(self):
        self.assertTrue(golden.has_evidence([{"text": golden.MARKER}]))
        self.assertFalse(golden.has_evidence([{"text": "unrelated"}]))
        self.assertFalse(golden.has_evidence({"text": golden.MARKER}))


if __name__ == "__main__":
    unittest.main()

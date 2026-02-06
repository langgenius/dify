import importlib
import sys
from uuid import UUID

import httpx
import pytest

from controllers.common import helpers
from controllers.common.helpers import FileInfo, guess_file_info_from_response


def make_response(
    url="https://example.com/file.txt",
    headers=None,
    content=None,
):
    return httpx.Response(
        200,
        request=httpx.Request("GET", url),
        headers=headers or {},
        content=content or b"",
    )


class TestGuessFileInfoFromResponse:
    def test_filename_from_url(self):
        response = make_response(
            url="https://example.com/test.pdf",
            content=b"Hello World",
        )

        info = guess_file_info_from_response(response)

        assert info.filename == "test.pdf"
        assert info.extension == ".pdf"
        assert info.mimetype == "application/pdf"

    def test_filename_from_content_disposition(self):
        headers = {
            "Content-Disposition": "attachment; filename=myfile.csv",
            "Content-Type": "text/csv",
        }
        response = make_response(
            url="https://example.com/",
            headers=headers,
            content=b"Hello World",
        )

        info = guess_file_info_from_response(response)

        assert info.filename == "myfile.csv"
        assert info.extension == ".csv"
        assert info.mimetype == "text/csv"

    @pytest.mark.parametrize(
        ("magic_available", "expected_ext"),
        [
            (True, "txt"),
            (False, "bin"),
        ],
    )
    def test_generated_filename_when_missing(self, monkeypatch, magic_available, expected_ext):
        if magic_available:
            if helpers.magic is None:
                pytest.skip("python-magic is not installed, cannot run 'magic_available=True' test variant")
        else:
            monkeypatch.setattr(helpers, "magic", None)

        response = make_response(
            url="https://example.com/",
            content=b"Hello World",
        )

        info = guess_file_info_from_response(response)

        name, ext = info.filename.split(".")
        UUID(name)
        assert ext == expected_ext

    def test_mimetype_from_header_when_unknown(self):
        headers = {"Content-Type": "application/json"}
        response = make_response(
            url="https://example.com/file.unknown",
            headers=headers,
            content=b'{"a": 1}',
        )

        info = guess_file_info_from_response(response)

        assert info.mimetype == "application/json"

    def test_extension_added_when_missing(self):
        headers = {"Content-Type": "image/png"}
        response = make_response(
            url="https://example.com/image",
            headers=headers,
            content=b"fakepngdata",
        )

        info = guess_file_info_from_response(response)

        assert info.extension == ".png"
        assert info.filename.endswith(".png")

    def test_content_length_used_as_size(self):
        headers = {
            "Content-Length": "1234",
            "Content-Type": "text/plain",
        }
        response = make_response(
            url="https://example.com/a.txt",
            headers=headers,
            content=b"a" * 1234,
        )

        info = guess_file_info_from_response(response)

        assert info.size == 1234

    def test_size_minus_one_when_header_missing(self):
        response = make_response(url="https://example.com/a.txt")

        info = guess_file_info_from_response(response)

        assert info.size == -1

    def test_fallback_to_bin_extension(self):
        headers = {"Content-Type": "application/octet-stream"}
        response = make_response(
            url="https://example.com/download",
            headers=headers,
            content=b"\x00\x01\x02\x03",
        )

        info = guess_file_info_from_response(response)

        assert info.extension == ".bin"
        assert info.filename.endswith(".bin")

    def test_return_type(self):
        response = make_response()

        info = guess_file_info_from_response(response)

        assert isinstance(info, FileInfo)


class TestMagicImportWarnings:
    @pytest.mark.parametrize(
        ("platform_name", "expected_message"),
        [
            ("Windows", "pip install python-magic-bin"),
            ("Darwin", "brew install libmagic"),
            ("Linux", "sudo apt-get install libmagic1"),
            ("Other", "install `libmagic`"),
        ],
    )
    def test_magic_import_warning_per_platform(
        self,
        monkeypatch,
        platform_name,
        expected_message,
    ):
        # Save original state
        orig_magic = sys.modules.get("magic")
        orig_helpers = sys.modules.get(helpers.__name__)
        
        try:
            sys.modules.pop("magic", None)

            monkeypatch.setitem(sys.modules, "magic", None)

            monkeypatch.setattr(helpers.platform, "system", lambda: platform_name)

            with pytest.warns(UserWarning, match="To use python-magic") as warning:
                importlib.reload(helpers)

            assert expected_message in str(warning[0].message)
            assert helpers.magic is None
        finally:
            if orig_magic is None:
                sys.modules.pop("magic", None)
            else:
                sys.modules["magic"] = orig_magic
            
            if orig_helpers is not None:
                sys.modules[helpers.__name__] = orig_helpers
                importlib.reload(orig_helpers)

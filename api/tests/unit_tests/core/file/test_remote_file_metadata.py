from collections.abc import Mapping, Sequence
from types import ModuleType
from uuid import UUID

import httpx
import pytest

from core.file import remote_file_metadata
from core.file.remote_file_metadata import FileInfo, InvalidRemoteFileMetadataError, guess_file_info_from_response


def make_response(
    url: str = "https://example.com/file.txt",
    headers: dict[str, str] | None = None,
    content: bytes | None = None,
) -> httpx.Response:
    return httpx.Response(
        200,
        request=httpx.Request("GET", url),
        headers=headers or {},
        content=content or b"",
    )


class TestGuessFileInfoFromResponse:
    def test_filename_from_url(self) -> None:
        response = make_response(
            url="https://example.com/test.pdf",
            content=b"Hello World",
        )

        info = guess_file_info_from_response(response)

        assert info.filename == "test.pdf"
        assert info.extension == ".pdf"
        assert info.mimetype == "application/pdf"

    def test_filename_from_content_disposition(self) -> None:
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
    def test_generated_filename_when_missing(
        self,
        monkeypatch: pytest.MonkeyPatch,
        magic_available: bool,
        expected_ext: str,
    ) -> None:
        if magic_available:
            if remote_file_metadata.magic is None:
                pytest.skip("python-magic is not installed, cannot run 'magic_available=True' test variant")
        else:
            monkeypatch.setattr(remote_file_metadata, "magic", None)

        response = make_response(
            url="https://example.com/",
            content=b"Hello World",
        )

        info = guess_file_info_from_response(response)

        name, ext = info.filename.split(".")
        UUID(name)
        assert ext == expected_ext

    def test_mimetype_from_header_when_unknown(self) -> None:
        headers = {"Content-Type": "application/json"}
        response = make_response(
            url="https://example.com/file.unknown",
            headers=headers,
            content=b'{"a": 1}',
        )

        info = guess_file_info_from_response(response)

        assert info.mimetype == "application/json"

    def test_extension_added_when_missing(self) -> None:
        headers = {"Content-Type": "image/png"}
        response = make_response(
            url="https://example.com/image",
            headers=headers,
            content=b"fakepngdata",
        )

        info = guess_file_info_from_response(response)

        assert info.extension == ".png"
        assert info.filename.endswith(".png")

    def test_content_length_used_as_size(self) -> None:
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

    def test_size_minus_one_when_header_missing(self) -> None:
        response = make_response(url="https://example.com/a.txt")

        info = guess_file_info_from_response(response)

        assert info.size == -1

    def test_invalid_content_length_raises_typed_metadata_error(self) -> None:
        response = make_response(headers={"Content-Length": "not-a-number"})

        with pytest.raises(InvalidRemoteFileMetadataError) as error_info:
            guess_file_info_from_response(response)

        assert isinstance(error_info.value.__cause__, ValueError)

    def test_fallback_to_bin_extension(self) -> None:
        headers = {"Content-Type": "application/octet-stream"}
        response = make_response(
            url="https://example.com/download",
            headers=headers,
            content=b"\x00\x01\x02\x03",
        )

        info = guess_file_info_from_response(response)

        assert info.extension == ".bin"
        assert info.filename.endswith(".bin")

    def test_return_type(self) -> None:
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
        monkeypatch: pytest.MonkeyPatch,
        platform_name: str,
        expected_message: str,
    ) -> None:
        import builtins
        import importlib

        # Force ImportError when "magic" is imported
        real_import = builtins.__import__

        def fake_import(
            name: str,
            global_vars: Mapping[str, object] | None = None,
            local_vars: Mapping[str, object] | None = None,
            fromlist: Sequence[str] = (),
            level: int = 0,
        ) -> ModuleType:
            if name == "magic":
                raise ImportError("No module named magic")
            return real_import(name, global_vars, local_vars, fromlist, level)

        monkeypatch.setattr(builtins, "__import__", fake_import)
        monkeypatch.setattr("platform.system", lambda: platform_name)

        # Remove the metadata module so it imports fresh
        import sys

        original_metadata = sys.modules.get(remote_file_metadata.__name__)
        sys.modules.pop(remote_file_metadata.__name__, None)

        try:
            with pytest.warns(UserWarning, match="To use python-magic") as warning:
                importlib.import_module(remote_file_metadata.__name__)
            assert expected_message in str(warning[0].message)
        finally:
            if original_metadata is not None:
                sys.modules[remote_file_metadata.__name__] = original_metadata

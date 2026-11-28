"""Unit tests for refreshing expiring signed file URLs in stored payloads."""

from types import SimpleNamespace

import pytest

from libs.file_url_refresh import refresh_file_urls


@pytest.fixture
def fake_signing(monkeypatch: pytest.MonkeyPatch):
    """Stub the URL signing helpers and record every signed record id."""
    signed: dict[str, str] = {}

    def fake_upload_url(upload_file_id: str, **_kwargs: object) -> str:
        signed[upload_file_id] = "upload"
        return f"http://files.example/files/{upload_file_id}/file-preview?timestamp=1&sign=fresh-{upload_file_id}"

    def fake_tool_url(tool_file_id: str, extension: str = ".bin", **_kwargs: object) -> str:
        signed[tool_file_id] = "tool"
        return f"http://files.example/files/tools/{tool_file_id}{extension}?timestamp=1&sign=fresh-{tool_file_id}"

    from libs import file_url_refresh

    monkeypatch.setattr(file_url_refresh.file_helpers, "get_signed_file_url", fake_upload_url)
    monkeypatch.setattr(file_url_refresh.file_helpers, "get_signed_tool_file_url", fake_tool_url)
    return signed


def _local_file_mapping(**overrides):
    mapping = {
        "dify_model_identity": "__dify__file__",
        "id": None,
        "type": "image",
        "transfer_method": "local_file",
        "related_id": "d3f1a2b4-0000-0000-0000-000000000001",
        "filename": "IMG_3559.jpg",
        "extension": ".jpg",
        "mime_type": "image/jpeg",
        "url": "http://files.example/files/d3f1a2b4-0000-0000-0000-000000000001/file-preview?timestamp=1&sign=stale",
    }
    mapping.update(overrides)
    return mapping


class TestRefreshFileUrls:
    def test_resigns_local_file_url(self, fake_signing) -> None:
        payload = {"tupian": [_local_file_mapping()]}

        refreshed = refresh_file_urls(payload)

        file_mapping = refreshed["tupian"][0]
        assert "sign=fresh-d3f1a2b4-0000-0000-0000-000000000001" in file_mapping["url"]
        assert fake_signing == {"d3f1a2b4-0000-0000-0000-000000000001": "upload"}

    @pytest.mark.usefixtures("fake_signing")
    def test_resigns_tool_file_url_with_extension(self) -> None:
        payload = {
            "dify_model_identity": "__dify__file__",
            "type": "image",
            "transfer_method": "tool_file",
            "related_id": "aaaabbbb-0000-0000-0000-000000000002",
            "extension": ".png",
            "url": "http://files.example/files/tools/aaaabbbb-0000-0000-0000-000000000002.png?sign=stale",
        }

        refreshed = refresh_file_urls(payload)

        assert refreshed["url"].startswith("http://files.example/files/tools/aaaabbbb-0000-0000-0000-000000000002.png?")
        assert "sign=fresh-aaaabbbb-0000-0000-0000-000000000002" in refreshed["url"]

    @pytest.mark.usefixtures("fake_signing")
    def test_tool_file_without_extension_falls_back_to_bin(self) -> None:
        payload = {
            "dify_model_identity": "__dify__file__",
            "type": "image",
            "transfer_method": "tool_file",
            "related_id": "aaaabbbb-0000-0000-0000-000000000003",
            "extension": None,
            "url": "http://files.example/files/tools/aaaabbbb-0000-0000-0000-000000000003?sign=stale",
        }

        refreshed = refresh_file_urls(payload)

        assert "/tools/aaaabbbb-0000-0000-0000-000000000003.bin?" in refreshed["url"]

    @pytest.mark.usefixtures("fake_signing")
    def test_remote_url_files_are_left_untouched(self) -> None:
        external = "https://cdn.example.com/picture.jpg"
        payload = {
            "dify_model_identity": "__dify__file__",
            "type": "image",
            "transfer_method": "remote_url",
            "remote_url": external,
            "url": external,
        }

        assert refresh_file_urls(payload) == payload

    @pytest.mark.usefixtures("fake_signing")
    def test_file_without_record_id_is_kept_as_is(self) -> None:
        payload = _local_file_mapping(related_id=None)

        assert refresh_file_urls(payload) == payload

    @pytest.mark.usefixtures("fake_signing")
    def test_non_file_values_pass_through(self) -> None:
        payload = {"inputs": {"query": "hi", "count": 2, "tags": ["a", "b"]}, "status": "succeeded"}

        assert refresh_file_urls(payload) == payload

    @pytest.mark.usefixtures("fake_signing")
    def test_resigns_files_nested_in_lists_and_dicts(self) -> None:
        payload = {
            "outer": [
                {"nested": [_local_file_mapping()]},
            ],
        }

        refreshed = refresh_file_urls(payload)

        assert "sign=fresh-d3f1a2b4-0000-0000-0000-000000000001" in refreshed["outer"][0]["nested"][0]["url"]

    def test_signing_failure_keeps_original_mapping(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from libs import file_url_refresh

        def boom(*_args: object, **_kwargs: object):
            raise RuntimeError("workflow file runtime is not configured")

        monkeypatch.setattr(file_url_refresh.file_helpers, "get_signed_file_url", boom)
        payload = _local_file_mapping()

        refreshed = refresh_file_urls(payload)

        assert refreshed["url"] == payload["url"]

    @pytest.mark.usefixtures("fake_signing")
    def test_accepts_enum_transfer_method(self) -> None:
        payload = _local_file_mapping(transfer_method=SimpleNamespace(value="local_file"))

        refreshed = refresh_file_urls(payload)

        assert "sign=fresh-d3f1a2b4-0000-0000-0000-000000000001" in refreshed["url"]

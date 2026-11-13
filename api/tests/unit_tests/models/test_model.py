import base64
import hashlib
import hmac
import importlib
import json
import types
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from configs import dify_config
from models import model as model_module
from models.model import App, AppMode, AppModelConfig, Message


@pytest.mark.parametrize(
    ("enabled", "strategy", "expected_mode"),
    [
        (True, "react", AppMode.AGENT_CHAT),
        (True, "function_call", AppMode.AGENT_CHAT),
        (True, {"type": "function_call"}, AppMode.CHAT),
        (True, ["react"], AppMode.CHAT),
        (True, None, AppMode.CHAT),
        (True, "unknown", AppMode.CHAT),
        (False, "react", AppMode.CHAT),
    ],
)
def test_legacy_agent_strategy_preserves_invalid_configuration(
    monkeypatch: pytest.MonkeyPatch, enabled: bool, strategy: object, expected_mode: AppMode
) -> None:
    engine = create_engine("sqlite:///:memory:")
    try:
        App.__table__.create(engine)
        AppModelConfig.__table__.create(engine)
        with Session(engine, expire_on_commit=False) as session:
            monkeypatch.setattr(model_module.db, "session", session)
            app = App(tenant_id=str(uuid4()), name="Legacy Agent", mode=AppMode.CHAT)
            session.add(app)
            session.flush()
            config = AppModelConfig(app_id=app.id, agent_mode=json.dumps({"enabled": enabled, "strategy": strategy}))
            session.add(config)
            session.flush()
            app.app_model_config_id = config.id
            session.commit()

            assert app.mode_compatible_with_agent == expected_mode

            session.expire_all()
            assert app.mode == expected_mode
            assert config.agent_mode_dict["strategy"] == strategy
    finally:
        engine.dispose()


@pytest.fixture(autouse=True)
def patch_file_helpers(monkeypatch: pytest.MonkeyPatch):
    """
    Patch file_helpers.get_signed_file_url to a deterministic stub.
    """
    model_module = importlib.import_module("models.model")
    dummy = types.SimpleNamespace(get_signed_file_url=lambda fid: f"https://signed.example/{fid}")
    # Inject/override file_helpers on models.model
    monkeypatch.setattr(model_module, "file_helpers", dummy, raising=False)


def _signed_preview_url(file_id: str, *, kind: str = "file", timestamp: str = "111", nonce: str = "222") -> str:
    """Build a preview URL whose signature is authentic under the current SECRET_KEY."""
    payload = f"{kind}-preview|{file_id}|{timestamp}|{nonce}"
    sign = base64.urlsafe_b64encode(
        hmac.new(dify_config.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest()
    ).decode()
    return f"/files/{file_id}/{kind}-preview?timestamp={timestamp}&nonce={nonce}&sign={sign}"


def _wrap_md(url: str) -> str:
    """
    Wrap a raw URL into the markdown that re_sign_file_url_answer expects:
    [link](<url>)
    """
    return f"please click [file]({url}) to download."


def test_file_preview_valid_replaced():
    """
    Valid file-preview URL must be re-signed:
    - Extract upload_file_id correctly
    - Replace the original URL with the signed URL
    """
    upload_id = "abc-123"
    url = _signed_preview_url(upload_id, timestamp="111", nonce="222")
    msg = Message(answer=_wrap_md(url))

    out = msg.re_sign_file_url_answer
    assert f"https://signed.example/{upload_id}" in out
    assert url not in out


def test_file_preview_misspelled_not_replaced():
    """
    Misspelled endpoint 'file-previe?timestamp=' should NOT be rewritten.
    """
    upload_id = "zzz-001"
    # path deliberately misspelled: file-previe? (missing 'w')
    # and we append &note=file-preview to trick the old `"file-preview" in url` check.
    url = f"/files/{upload_id}/file-previe?timestamp=111&nonce=222&sign=333&note=file-preview"
    original = _wrap_md(url)
    msg = Message(answer=original)

    out = msg.re_sign_file_url_answer
    # Expect NO replacement, should not rewrite misspelled file-previe URL
    assert out == original


def test_image_preview_valid_replaced():
    """
    Valid image-preview URL must be re-signed.
    """
    upload_id = "img-789"
    url = _signed_preview_url(upload_id, kind="image", timestamp="123", nonce="456")
    msg = Message(answer=_wrap_md(url))

    out = msg.re_sign_file_url_answer
    assert f"https://signed.example/{upload_id}" in out
    assert url not in out


def test_image_preview_misspelled_not_replaced():
    """
    Misspelled endpoint 'image-previe?timestamp=' should NOT be rewritten.
    """
    upload_id = "img-err-42"
    url = f"/files/{upload_id}/image-previe?timestamp=1&nonce=2&sign=3&note=image-preview"
    original = _wrap_md(url)
    msg = Message(answer=original)

    out = msg.re_sign_file_url_answer
    # Expect NO replacement, should not rewrite misspelled image-previe URL
    assert out == original


def test_forged_or_unsigned_file_urls_are_not_re_signed():
    """Only URLs carrying an authentic HMAC may be renewed; forged links stay unchanged."""
    forged_preview = "/files/victim-file/file-preview?timestamp=111&nonce=222&sign=forged"
    forged_image = "/files/victim-image/image-preview?timestamp=111&nonce=222&sign=forged"
    forged_tool = "/files/tools/victim-tool.png?timestamp=111&nonce=222&sign=forged"
    answer = f"[a]({forged_preview}) [b]({forged_image}) [c]({forged_tool})"

    with patch.object(model_module, "sign_tool_file") as sign_tool_file:
        assert Message(answer=answer).re_sign_file_url_answer == answer
    sign_tool_file.assert_not_called()


def test_authentic_tool_file_url_is_re_signed():
    tool_url = _signed_preview_url("tool-1").replace("/files/tool-1/file-preview", "/files/tools/tool-1.png")

    with patch.object(model_module, "sign_tool_file", return_value="https://signed.example/tool-1.png") as sign:
        out = Message(answer=_wrap_md(tool_url)).re_sign_file_url_answer

    sign.assert_called_once_with(tool_file_id="tool-1", extension=".png")
    assert "https://signed.example/tool-1.png" in out

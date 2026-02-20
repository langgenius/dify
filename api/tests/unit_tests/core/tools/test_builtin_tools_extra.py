from __future__ import annotations

from types import SimpleNamespace

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.model_runtime.entities.model_entities import ModelPropertyKey
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.builtin_tool.providers._positions import BuiltinToolProviderSort
from core.tools.builtin_tool.providers.audio.audio import AudioToolProvider
from core.tools.builtin_tool.providers.audio.tools.asr import ASRTool
from core.tools.builtin_tool.providers.audio.tools.tts import TTSTool
from core.tools.builtin_tool.providers.code.code import CodeToolProvider
from core.tools.builtin_tool.providers.code.tools.simple_code import SimpleCode
from core.tools.builtin_tool.providers.time.time import WikiPediaProvider
from core.tools.builtin_tool.providers.time.tools.current_time import CurrentTimeTool
from core.tools.builtin_tool.providers.time.tools.localtime_to_timestamp import LocaltimeToTimestampTool
from core.tools.builtin_tool.providers.time.tools.timestamp_to_localtime import TimestampToLocaltimeTool
from core.tools.builtin_tool.providers.time.tools.timezone_conversion import TimezoneConversionTool
from core.tools.builtin_tool.providers.time.tools.weekday import WeekdayTool
from core.tools.builtin_tool.providers.webscraper.tools.webscraper import WebscraperTool
from core.tools.builtin_tool.providers.webscraper.webscraper import WebscraperProvider
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage
from core.tools.errors import ToolInvokeError
from core.workflow.file.enums import FileType


def _build_builtin_tool(tool_cls):
    entity = ToolEntity(
        identity=ToolIdentity(
            author="author",
            name="tool-a",
            label=I18nObject(en_US="tool-a"),
            provider="provider-a",
        ),
        parameters=[],
    )
    runtime = ToolRuntime(tenant_id="tenant-1", invoke_from=InvokeFrom.DEBUGGER)
    return tool_cls(provider="provider-a", entity=entity, runtime=runtime)


def _raise_runtime_error(*args, **kwargs):
    raise RuntimeError("boom")


def test_current_time_tool():
    current_tool = _build_builtin_tool(CurrentTimeTool)
    utc_text = list(current_tool.invoke(user_id="u", tool_parameters={"timezone": "UTC"}))[0].message.text
    assert utc_text

    invalid_tz = list(current_tool.invoke(user_id="u", tool_parameters={"timezone": "Invalid/TZ"}))[0].message.text
    assert "Invalid timezone" in invalid_tz


def test_localtime_to_timestamp_tool():
    localtime_tool = _build_builtin_tool(LocaltimeToTimestampTool)
    ts_message = list(
        localtime_tool.invoke(user_id="u", tool_parameters={"localtime": "2024-01-01 10:00:00", "timezone": "UTC"})
    )[0].message.text
    assert ts_message.isdigit()
    with pytest.raises(ToolInvokeError):
        LocaltimeToTimestampTool.localtime_to_timestamp("bad", "%Y-%m-%d %H:%M:%S", "UTC")


def test_timestamp_to_localtime_tool():
    to_local_tool = _build_builtin_tool(TimestampToLocaltimeTool)
    local_text = list(to_local_tool.invoke(user_id="u", tool_parameters={"timestamp": 1704067200, "timezone": "UTC"}))[
        0
    ].message.text
    assert "2024" in local_text
    with pytest.raises(ToolInvokeError):
        TimestampToLocaltimeTool.timestamp_to_localtime("bad", "UTC")  # type: ignore[arg-type]


def test_timezone_conversion_tool():
    timezone_tool = _build_builtin_tool(TimezoneConversionTool)
    converted = list(
        timezone_tool.invoke(
            user_id="u",
            tool_parameters={
                "current_time": "2024-01-01 08:00:00",
                "current_timezone": "UTC",
                "target_timezone": "Asia/Tokyo",
            },
        )
    )[0].message.text
    assert converted.startswith("2024-01-01")
    with pytest.raises(ToolInvokeError):
        TimezoneConversionTool.timezone_convert("bad", "UTC", "Asia/Tokyo")


def test_weekday_tool():
    weekday_tool = _build_builtin_tool(WeekdayTool)
    valid = list(weekday_tool.invoke(user_id="u", tool_parameters={"year": 2024, "month": 1, "day": 1}))[0].message.text
    assert "January 1, 2024" in valid
    invalid = list(weekday_tool.invoke(user_id="u", tool_parameters={"year": 2024, "month": 2, "day": 31}))[
        0
    ].message.text
    assert "Invalid date" in invalid
    with pytest.raises(ValueError, match="Month is required"):
        list(weekday_tool.invoke(user_id="u", tool_parameters={"year": 2024, "day": 1}))


def test_simple_code_valid_execution(monkeypatch):
    simple_code = _build_builtin_tool(SimpleCode)

    monkeypatch.setattr(
        "core.tools.builtin_tool.providers.code.tools.simple_code.CodeExecutor.execute_code",
        lambda *a: "ok",
    )
    result = list(
        simple_code.invoke(
            user_id="u",
            tool_parameters={"language": "python3", "code": "print(1)"},
        )
    )[0].message.text
    assert result == "ok"


def test_simple_code_invalid_language():
    simple_code = _build_builtin_tool(SimpleCode)

    with pytest.raises(ValueError, match="Only python3 and javascript"):
        list(simple_code.invoke(user_id="u", tool_parameters={"language": "go", "code": "fmt.Println(1)"}))


def test_simple_code_execution_error(monkeypatch):
    simple_code = _build_builtin_tool(SimpleCode)

    monkeypatch.setattr(
        "core.tools.builtin_tool.providers.code.tools.simple_code.CodeExecutor.execute_code",
        _raise_runtime_error,
    )
    with pytest.raises(ToolInvokeError, match="boom"):
        list(simple_code.invoke(user_id="u", tool_parameters={"language": "python3", "code": "print(1)"}))


def test_webscraper_empty_url():
    webscraper = _build_builtin_tool(WebscraperTool)
    empty = list(webscraper.invoke(user_id="u", tool_parameters={"url": ""}))[0].message.text
    assert empty == "Please input url"


def test_webscraper_fetch(monkeypatch):
    webscraper = _build_builtin_tool(WebscraperTool)
    monkeypatch.setattr("core.tools.builtin_tool.providers.webscraper.tools.webscraper.get_url", lambda *a, **k: "page")
    full = list(webscraper.invoke(user_id="u", tool_parameters={"url": "https://example.com"}))[0].message.text
    assert full == "page"


def test_webscraper_summary(monkeypatch):
    webscraper = _build_builtin_tool(WebscraperTool)
    monkeypatch.setattr("core.tools.builtin_tool.providers.webscraper.tools.webscraper.get_url", lambda *a, **k: "page")
    monkeypatch.setattr(webscraper, "summary", lambda user_id, content: "summary")
    summarized = list(
        webscraper.invoke(
            user_id="u",
            tool_parameters={"url": "https://example.com", "generate_summary": True},
        )
    )[0].message.text
    assert summarized == "summary"


def test_webscraper_fetch_error(monkeypatch):
    webscraper = _build_builtin_tool(WebscraperTool)
    monkeypatch.setattr(
        "core.tools.builtin_tool.providers.webscraper.tools.webscraper.get_url",
        _raise_runtime_error,
    )
    with pytest.raises(ToolInvokeError, match="boom"):
        list(webscraper.invoke(user_id="u", tool_parameters={"url": "https://example.com"}))


def test_asr_invalid_file():
    asr = _build_builtin_tool(ASRTool)
    file_obj = type("F", (), {"type": FileType.DOCUMENT})()
    invalid_file = list(asr.invoke(user_id="u", tool_parameters={"audio_file": file_obj}))[0].message.text
    assert "not a valid audio file" in invalid_file


def test_asr_valid_file_invocation(monkeypatch):
    asr = _build_builtin_tool(ASRTool)
    model_instance = type("M", (), {"invoke_speech2text": lambda self, file, user: "transcript"})()
    model_manager = type("Mgr", (), {"get_model_instance": lambda *a, **k: model_instance})()
    monkeypatch.setattr("core.tools.builtin_tool.providers.audio.tools.asr.download", lambda file: b"audio-bytes")
    monkeypatch.setattr("core.tools.builtin_tool.providers.audio.tools.asr.ModelManager", lambda: model_manager)
    audio_file = type("AF", (), {"type": FileType.AUDIO})()
    ok = list(asr.invoke(user_id="u", tool_parameters={"audio_file": audio_file, "model": "p#m"}))[0].message.text
    assert ok == "transcript"


def test_asr_available_models_and_runtime_parameters(monkeypatch):
    asr = _build_builtin_tool(ASRTool)
    provider_model = type("PM", (), {"provider": "p", "models": [type("Model", (), {"model": "m"})()]})()
    monkeypatch.setattr(
        "core.tools.builtin_tool.providers.audio.tools.asr.ModelProviderService.get_models_by_model_type",
        lambda *a, **k: [provider_model],
    )
    assert asr.get_available_models() == [("p", "m")]
    assert asr.get_runtime_parameters()[0].name == "model"


def test_tts_invoke_returns_messages(monkeypatch):
    tts = _build_builtin_tool(TTSTool)
    voices_model_instance = type(
        "TTSM",
        (),
        {
            "get_tts_voices": lambda self: [{"value": "voice-1"}],
            "invoke_tts": lambda self, **kwargs: [b"a", b"b"],
        },
    )()
    monkeypatch.setattr(
        "core.tools.builtin_tool.providers.audio.tools.tts.ModelManager",
        lambda: type("M", (), {"get_model_instance": lambda *a, **k: voices_model_instance})(),
    )
    messages = list(tts.invoke(user_id="u", tool_parameters={"model": "p#m", "text": "hello"}))
    assert [m.type for m in messages] == [ToolInvokeMessage.MessageType.TEXT, ToolInvokeMessage.MessageType.BLOB]


def test_tts_get_available_models_requires_runtime():
    tts = _build_builtin_tool(TTSTool)
    tts.runtime = None
    with pytest.raises(ValueError, match="Runtime is required"):
        tts.get_available_models()


def test_tts_tool_raises_when_runtime_missing():
    tts = _build_builtin_tool(TTSTool)
    tts.runtime = None
    with pytest.raises(ValueError, match="Runtime is required"):
        list(tts.invoke(user_id="u", tool_parameters={"model": "p#m", "text": "hello"}))


def test_tts_tool_raises_when_voice_value_empty(monkeypatch):
    tts = _build_builtin_tool(TTSTool)
    tts.runtime = ToolRuntime(tenant_id="tenant-1", invoke_from=InvokeFrom.DEBUGGER)
    model_with_empty_voice = type(
        "TTSModelEmptyVoice",
        (),
        {
            "get_tts_voices": lambda self: [{"value": None}],
            "invoke_tts": lambda self, **kwargs: [b"x"],
        },
    )()
    monkeypatch.setattr(
        "core.tools.builtin_tool.providers.audio.tools.tts.ModelManager",
        lambda: type("Manager", (), {"get_model_instance": lambda *args, **kwargs: model_with_empty_voice})(),
    )
    with pytest.raises(ValueError, match="no voice available"):
        list(tts.invoke(user_id="u", tool_parameters={"model": "p#m", "text": "hello"}))


def test_tts_tool_raises_when_no_voices(monkeypatch):
    tts = _build_builtin_tool(TTSTool)
    tts.runtime = ToolRuntime(tenant_id="tenant-1", invoke_from=InvokeFrom.DEBUGGER)
    model_without_voices = type(
        "TTSModelNoVoices",
        (),
        {
            "get_tts_voices": lambda self: [],
            "invoke_tts": lambda self, **kwargs: [b"x"],
        },
    )()
    monkeypatch.setattr(
        "core.tools.builtin_tool.providers.audio.tools.tts.ModelManager",
        lambda: type("Manager", (), {"get_model_instance": lambda *args, **kwargs: model_without_voices})(),
    )
    with pytest.raises(ValueError, match="no voice available"):
        list(tts.invoke(user_id="u", tool_parameters={"model": "p#m", "text": "hello"}))


def test_tts_tool_get_available_models_and_runtime_parameters(monkeypatch):
    tts = _build_builtin_tool(TTSTool)

    model_1 = SimpleNamespace(
        model="model-a",
        model_properties={ModelPropertyKey.VOICES: [{"mode": "v1", "name": "Voice 1"}]},
    )
    model_2 = SimpleNamespace(model="model-b", model_properties={})
    provider_models = [SimpleNamespace(provider="provider-a", models=[model_1, model_2])]
    monkeypatch.setattr(
        "core.tools.builtin_tool.providers.audio.tools.tts.ModelProviderService.get_models_by_model_type",
        lambda *args, **kwargs: provider_models,
    )

    available_models = tts.get_available_models()
    assert available_models == [
        ("provider-a", "model-a", [{"mode": "v1", "name": "Voice 1"}]),
        ("provider-a", "model-b", []),
    ]

    runtime_parameters = tts.get_runtime_parameters()
    assert runtime_parameters[0].name == "model"
    assert runtime_parameters[0].required is True
    assert runtime_parameters[0].options[0].value == "provider-a#model-a"
    assert runtime_parameters[1].name == "voice#provider-a#model-a"


def test_provider_classes_and_builtin_sort(monkeypatch):
    # Ensure pass-through _validate_credentials methods are executed.
    AudioToolProvider._validate_credentials(object.__new__(AudioToolProvider), "u", {})
    CodeToolProvider._validate_credentials(object.__new__(CodeToolProvider), "u", {})
    WikiPediaProvider._validate_credentials(object.__new__(WikiPediaProvider), "u", {})
    WebscraperProvider._validate_credentials(object.__new__(WebscraperProvider), "u", {})

    providers = [SimpleNamespace(name="b"), SimpleNamespace(name="a")]
    monkeypatch.setattr(BuiltinToolProviderSort, "_position", {})
    monkeypatch.setattr(
        "core.tools.builtin_tool.providers._positions.get_tool_position_map",
        lambda _: {"a": 0, "b": 1},
    )
    monkeypatch.setattr(
        "core.tools.builtin_tool.providers._positions.sort_by_position_map",
        lambda position, values, name_func: sorted(values, key=lambda x: name_func(x)),
    )
    sorted_providers = BuiltinToolProviderSort.sort(providers)
    assert [p.name for p in sorted_providers] == ["a", "b"]

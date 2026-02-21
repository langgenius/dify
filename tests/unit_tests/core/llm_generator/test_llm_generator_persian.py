import sys
import types
import json
from pathlib import Path

# Ensure the repo `api/` directory is importable so tests can import `core.*` without external env setup
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "api"))

# Lightweight stubs to avoid importing heavy application modules during unit tests
m = types.ModuleType("core.model_manager")


class ModelManager:
    def get_default_model_instance(self, tenant_id, model_type):
        raise NotImplementedError

    def get_model_instance(self, tenant_id, model_type, provider=None, model=None):
        raise NotImplementedError


m.ModelManager = ModelManager
sys.modules["core.model_manager"] = m

m2 = types.ModuleType("core.ops.ops_trace_manager")


class TraceTask:
    def __init__(self, *args, **kwargs):
        # store attributes for potential inspection in tests
        for k, v in kwargs.items():
            setattr(self, k, v)
        self.args = args
        self.kwargs = kwargs


class TraceQueueManager:
    def __init__(self, *a, **k):
        pass

    def add_trace_task(self, *a, **k):
        pass


m2.TraceTask = TraceTask
m2.TraceQueueManager = TraceQueueManager
sys.modules["core.ops.ops_trace_manager"] = m2

# Stub core.ops.utils to avoid importing heavy dependencies (db, models) during tests
m_ops = types.ModuleType("core.ops.utils")
from contextlib import contextmanager


@contextmanager
def measure_time():
    class Timer:
        pass

    t = Timer()
    yield t


m_ops.measure_time = measure_time
sys.modules["core.ops.utils"] = m_ops

m3 = types.ModuleType("core.model_runtime.entities.llm_entities")


class LLMUsage:
    @classmethod
    def empty_usage(cls):
        return cls()


class LLMResult:
    def __init__(self, model=None, prompt_messages=None, message=None, usage=None):
        self.model = model
        self.prompt_messages = prompt_messages
        self.message = message
        self.usage = usage


m3.LLMUsage = LLMUsage
m3.LLMResult = LLMResult
sys.modules["core.model_runtime.entities.llm_entities"] = m3

m4 = types.ModuleType("core.model_runtime.entities.message_entities")


class PromptMessage:
    def __init__(self, content=None):
        self.content = content

    def get_text_content(self):
        return str(self.content) if self.content is not None else ""


class TextPromptMessageContent:
    def __init__(self, data):
        self.data = data


class ImagePromptMessageContent:
    def __init__(self, url=None, base64_data=None, mime_type=None, filename=None):
        self.url = url
        self.base64_data = base64_data
        self.mime_type = mime_type
        self.filename = filename


class DocumentPromptMessageContent:
    def __init__(self, url=None):
        self.url = url


class AudioPromptMessageContent(DocumentPromptMessageContent):
    pass


class VideoPromptMessageContent(DocumentPromptMessageContent):
    pass


class AssistantPromptMessage(PromptMessage):
    def __init__(self, content):
        super().__init__(content)


class UserPromptMessage(PromptMessage):
    def __init__(self, content):
        super().__init__(content)


class SystemPromptMessage(PromptMessage):
    def __init__(self, content=None):
        super().__init__(content)


m4.PromptMessage = PromptMessage
m4.AssistantPromptMessage = AssistantPromptMessage
m4.UserPromptMessage = UserPromptMessage
m4.SystemPromptMessage = SystemPromptMessage
m4.TextPromptMessageContent = TextPromptMessageContent
m4.ImagePromptMessageContent = ImagePromptMessageContent
m4.DocumentPromptMessageContent = DocumentPromptMessageContent
m4.AudioPromptMessageContent = AudioPromptMessageContent
m4.VideoPromptMessageContent = VideoPromptMessageContent
sys.modules["core.model_runtime.entities.message_entities"] = m4

m5 = types.ModuleType("core.model_runtime.entities.model_entities")


class ModelType:
    LLM = None


m5.ModelType = ModelType
sys.modules["core.model_runtime.entities.model_entities"] = m5

# Stub minimal 'extensions' and 'models' packages to avoid importing heavy application code during tests
ext_db = types.ModuleType("extensions.ext_database")
ext_db.db = None
sys.modules["extensions.ext_database"] = ext_db
ext_storage = types.ModuleType("extensions.ext_storage")
ext_storage.storage = None
sys.modules["extensions.ext_storage"] = ext_storage

models_m = types.ModuleType("models")


class App:
    pass


class Message:
    pass


class WorkflowNodeExecutionModel:
    pass


models_m.App = App
models_m.Message = Message
models_m.WorkflowNodeExecutionModel = WorkflowNodeExecutionModel
sys.modules["models"] = models_m

models_workflow = types.ModuleType("models.workflow")


class Workflow:
    pass


models_workflow.Workflow = Workflow
sys.modules["models.workflow"] = models_workflow

from core.llm_generator.llm_generator import LLMGenerator
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from core.model_runtime.entities.message_entities import AssistantPromptMessage
from core.model_manager import ModelManager


class DummyModelInstance:
    def __init__(self, content):
        self._content = content

    def invoke_llm(self, prompt_messages=None, model_parameters=None, stream=False):
        # Return an LLMResult-like object with the message content we expect
        return LLMResult(
            model="dummy",
            prompt_messages=[],
            message=AssistantPromptMessage(content=self._content),
            usage=LLMUsage.empty_usage(),
        )


def test_generate_conversation_name_persian(monkeypatch):
    # Arrange: Persian input that doesn't necessarily include Persian-specific letters
    query = "سلام دوست من، میخواهم درباره تنظیمات حساب صحبت کنم"

    # Mock the default model instance to return a Persian title in JSON format
    fake_output = json.dumps({"Your Output": "عنوان تستی"})
    dummy = DummyModelInstance(fake_output)

    monkeypatch.setattr(ModelManager, "get_default_model_instance", lambda self, tenant_id, model_type: dummy)

    # Act
    name = LLMGenerator.generate_conversation_name("tenant1", query)

    # Assert: title should be the Persian string we returned
    assert name == "عنوان تستی"


def test_contains_persian_character_and_heuristics(monkeypatch):
    from core.llm_generator.llm_generator import _contains_persian, _persian_chars_re, _PERSIAN_HEURISTIC

    # By single Persian-specific character
    assert _contains_persian("این یک تست پ") is True

    # By heuristic Persian word
    assert _contains_persian("سلام دوست") is True


def test_contains_persian_langdetect_fallback(monkeypatch):
    import core.llm_generator.llm_generator as lg

    # Simulate langdetect being available and detecting Persian
    monkeypatch.setattr(lg, "_langdetect_available", True)
    monkeypatch.setattr(lg, "detect", lambda text: "fa")

    assert lg._contains_persian("short ambiguous text") is True

    # Reset monkeypatch
    monkeypatch.setattr(lg, "_langdetect_available", False)
    monkeypatch.setattr(lg, "detect", None)

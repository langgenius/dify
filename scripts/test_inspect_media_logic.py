"""
InspectMediaTool – PURE LOGIC UNIT TEST
Fully isolated, no runtime, no services, no circular imports
"""

import sys
import os
import types
from types import SimpleNamespace

print("=" * 60)
print("InspectMediaTool PURE LOGIC TEST")
print("=" * 60)

# --------------------------------------------------
# STEP 1: Stub Tool base
# --------------------------------------------------
tool_mod = types.ModuleType("core.tools.__base.tool")


class FakeTool:
    pass


tool_mod.Tool = FakeTool
sys.modules["core.tools.__base.tool"] = tool_mod

# --------------------------------------------------
# STEP 2: Stub tool_entities (FULL FIX)
# --------------------------------------------------
entities_mod = types.ModuleType("core.tools.entities.tool_entities")


class ToolEntity:
    def __init__(self, identity=None, description=None):
        self.identity = identity
        self.description = description


class ToolIdentity:
    def __init__(self, name, provider=None, provider_type=None, icon=None, tags=None):
        self.name = name
        self.provider = provider
        self.provider_type = provider_type
        self.icon = icon
        self.tags = tags or []


class ToolDescription:
    def __init__(self, human=None, llm=None):
        self.human = human
        self.llm = llm


class ToolProviderType:
    BUILT_IN = "builtin"


class ToolInvokeMeta:
    def __init__(self, error=None):
        self.error = error

    @classmethod
    def success_instance(cls):
        return cls()

    @classmethod
    def error_instance(cls, msg):
        return cls(error=msg)


entities_mod.ToolEntity = ToolEntity
entities_mod.ToolIdentity = ToolIdentity
entities_mod.ToolDescription = ToolDescription
entities_mod.ToolProviderType = ToolProviderType
entities_mod.ToolInvokeMeta = ToolInvokeMeta

sys.modules["core.tools.entities.tool_entities"] = entities_mod

# --------------------------------------------------
# STEP 3: Stub Tool labels
# --------------------------------------------------
values_mod = types.ModuleType("core.tools.entities.values")


class ToolLabelEnum:
    MEDIA = "media"


values_mod.ToolLabelEnum = ToolLabelEnum
sys.modules["core.tools.entities.values"] = values_mod

# --------------------------------------------------
# STEP 4: Stub FileService (avoid circular import)
# --------------------------------------------------
# --------------------------------------------------
# STEP 4: Stub FileService (FULL)
# --------------------------------------------------
svc_mod = types.ModuleType("services.file_service")


class FakeFileService:
    @staticmethod
    def get_file_by_id(file_id):
        if file_id == "file_123":
            return SimpleNamespace(
                id="file_123",
                filename="photo.png",
                content_type="image/png",
                size=2048,
                duration=None,
            )
        return None


svc_mod.FileService = FakeFileService
sys.modules["services.file_service"] = svc_mod


# --------------------------------------------------
# STEP 5: Make api/ importable
# --------------------------------------------------
ROOT = os.path.dirname(os.path.dirname(__file__))
API = os.path.join(ROOT, "api")
sys.path.insert(0, API)

# --------------------------------------------------
# STEP 6: Import tool safely
# --------------------------------------------------
import core.tools.media.inspect_media as inspect_media

InspectMediaTool = inspect_media.InspectMediaTool

print("  Module imported safely")

# --------------------------------------------------
# STEP 7: Fake file object
# --------------------------------------------------
fake_file = SimpleNamespace(
    id="file_123",
    filename="photo.png",
    content_type="image/png",
    size=2048,
    duration=None,
)


# --------------------------------------------------
# STEP 8: Monkey-patch file_manager
# --------------------------------------------------
class FakeFileManager:
    @staticmethod
    def get_file(file_id):
        return fake_file if file_id == "file_123" else None


inspect_media.file_manager = FakeFileManager

# --------------------------------------------------
# STEP 9: Instantiate tool
# --------------------------------------------------
tool = InspectMediaTool.__new__(InspectMediaTool)

# --------------------------------------------------
# STEP 10: Success case
# --------------------------------------------------
result, meta = tool.invoke({"file_id": "file_123"})
assert result["filename"] == "photo.png"
assert meta.error is None
print("  PASS: valid media inspection")

# --------------------------------------------------
# STEP 11: Failure case
# --------------------------------------------------
result, meta = tool.invoke({"file_id": "missing"})
assert "not found" in result.lower()
assert meta.error is not None
print("  PASS: missing file handled")

print("\n  InspectMediaTool LOGIC VERIFIED")

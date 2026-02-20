"""
Logic-level test for InspectMediaTool

This test validates:
- Metadata extraction logic
- Error handling
WITHOUT importing Tool / ToolRuntime
"""

import sys
import os
from types import SimpleNamespace

# -------------------------------------------------------
# Add api/ to path
# -------------------------------------------------------
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = os.path.join(ROOT, "api")
sys.path.insert(0, API)

# -------------------------------------------------------
# Import ONLY the class body (safe)
# -------------------------------------------------------
from core.tools.media import inspect_media

InspectMediaTool = inspect_media.InspectMediaTool

print("=" * 50)
print("InspectMediaTool LOGIC Test")
print("=" * 50)

# -------------------------------------------------------
# Fake file object
# -------------------------------------------------------
fake_file = SimpleNamespace(
    id="file_123",
    filename="image.png",
    content_type="image/png",
    size=2048,
    duration=None,
)

# -------------------------------------------------------
# Monkey patch file_manager
# -------------------------------------------------------
original_file_manager = inspect_media.file_manager


class FakeFileManager:
    @staticmethod
    def get_file(file_id):
        if file_id == "file_123":
            return fake_file
        return None


inspect_media.file_manager = FakeFileManager

# -------------------------------------------------------
# Run tests
# -------------------------------------------------------
tool = InspectMediaTool.__new__(InspectMediaTool)

# Test: success
result, meta = tool.invoke({"file_id": "file_123"})
assert result["filename"] == "image.png"
assert meta.error is None
print("  PASS: metadata extraction works")

# Test: missing file
result, meta = tool.invoke({"file_id": "missing"})
assert "not found" in result.lower()
assert meta.error is not None
print("  PASS: missing file handled")

# -------------------------------------------------------
# Restore
# -------------------------------------------------------
inspect_media.file_manager = original_file_manager

print("\n  InspectMediaTool logic validated")

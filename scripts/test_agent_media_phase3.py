from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "api"

MEDIA_TOOL = API / "core" / "tools" / "media" / "inspect_media.py"
AGENT_RUNNER = API / "core" / "agent" / "base_agent_runner.py"


def fail(msg):
    print("❌ FAIL:", msg)
    sys.exit(1)


def ok(msg):
    print("  PASS:", msg)


print("=======================================")
print("Phase 3: Agent Media Tool Integration Test")
print("=======================================\n")

# --------------------------------------------------
# Test 1: inspect_media.py exists
# --------------------------------------------------
if not MEDIA_TOOL.exists():
    fail("inspect_media.py not found")

ok("inspect_media.py exists")

# --------------------------------------------------
# Test 2: InspectMediaTool definition
# --------------------------------------------------
media_src = MEDIA_TOOL.read_text(encoding="utf-8")

if "class InspectMediaTool" not in media_src:
    fail("InspectMediaTool class missing")

if "def get_entity" not in media_src:
    fail("get_entity() missing in InspectMediaTool")

if "inspect_media" not in media_src:
    fail("inspect_media identity missing")

ok("InspectMediaTool entity looks correct")

# --------------------------------------------------
# Test 3: Agent runner injection
# --------------------------------------------------
agent_src = AGENT_RUNNER.read_text(encoding="utf-8")

if "_init_prompt_tools" not in agent_src:
    fail("_init_prompt_tools not found")

if "InspectMediaTool" not in agent_src:
    fail("InspectMediaTool not referenced in agent runner")

if 'inputs.get("_media")' not in agent_src:
    fail("_media condition missing")

ok("Agent runner injects InspectMediaTool conditionally")

# --------------------------------------------------
# Test 4: Tool exposed to LLM
# --------------------------------------------------
if "PromptMessageTool" not in agent_src:
    fail("PromptMessageTool not used")

if "get_llm_parameters_schema" not in agent_src:
    fail("LLM schema exposure missing")

ok("InspectMediaTool exposed to LLM correctly")

print("\n=======================================")
print("  Phase 3 PASSED: Media Tool Integration")
print("=======================================")

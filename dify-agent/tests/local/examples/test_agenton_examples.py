import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _run_example(path: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, path],
        cwd=PROJECT_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def test_agenton_basics_example_smoke() -> None:
    result = _run_example("examples/agenton/basics.py")

    assert result.returncode == 0, result.stderr
    assert "Prompts:" in result.stdout
    assert "Tools:" in result.stdout
    assert "Lifecycle: ['create', 'tmp_leave', 'reenter', 'delete']" in result.stdout


def test_agenton_pydantic_ai_example_smoke() -> None:
    result = _run_example("examples/agenton/pydantic_ai_bridge.py")

    assert result.returncode == 0, result.stderr
    assert "SystemPromptPart: Prefer concrete details." in result.stdout
    assert "ToolCallPart: count_words(" in result.stdout
    assert "ToolCallPart: write_tagline(" in result.stdout
    assert "TextPart:" in result.stdout

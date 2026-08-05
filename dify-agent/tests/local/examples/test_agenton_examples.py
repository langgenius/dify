import os
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _run_example(path: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    _ = env.pop("OPENAI_API_KEY", None)
    python_path = os.pathsep.join(
        [
            str(PROJECT_ROOT / "src"),
            str(PROJECT_ROOT / "examples" / "agenton"),
            str(PROJECT_ROOT / "examples" / "dify_agent"),
            env.get("PYTHONPATH", ""),
        ]
    )
    env["PYTHONPATH"] = python_path

    return subprocess.run(
        [sys.executable, "-m", path],
        cwd=PROJECT_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def test_agenton_basics_example_smoke() -> None:
    result = _run_example("agenton_examples.basics")

    assert result.returncode == 0, result.stderr
    assert "Prompts:" in result.stdout
    assert "User prompts:" in result.stdout
    assert "Tools:" in result.stdout
    assert "Lifecycle: ['create', 'suspend', 'resume', 'delete']" in result.stdout


def test_agenton_pydantic_ai_example_smoke() -> None:
    result = _run_example("agenton_examples.pydantic_ai_bridge")

    assert result.returncode == 0, result.stderr
    assert "SystemPromptPart: Prefer concrete details." in result.stdout
    assert "UserPromptPart: [\"Use the tools for 'layer composition'.\"]" in result.stdout
    assert "ToolCallPart: count_words(" in result.stdout
    assert "ToolCallPart: write_tagline(" in result.stdout
    assert "TextPart:" in result.stdout


def test_agenton_session_snapshot_example_smoke() -> None:
    result = _run_example("agenton_examples.session_snapshot")

    assert result.returncode == 0, result.stderr
    assert "Snapshot:" in result.stdout
    assert "Rehydrated external handle: restored:demo-connection" in result.stdout

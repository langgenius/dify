from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import textwrap

import pytest


def test_client_public_exports_work_with_default_dependencies_only(tmp_path: Path) -> None:
    """Install the package without extras and verify client-facing imports work."""
    uv = shutil.which("uv")
    if uv is None:
        pytest.skip("uv is required to verify default-dependency imports in an isolated environment")

    project_root = Path(__file__).resolve().parents[3]
    venv_path = tmp_path / "client-default-venv"
    python_path = venv_path / "bin" / "python"

    subprocess.run([uv, "venv", str(venv_path)], cwd=project_root, check=True)
    subprocess.run(
        [uv, "pip", "install", "--python", str(python_path), "."],
        cwd=project_root,
        check=True,
    )

    script = textwrap.dedent(
        """
        from __future__ import annotations

        import importlib
        from importlib.metadata import PackageNotFoundError, distribution
        from pathlib import Path
        import re
        import sys
        import tomllib


        def requirement_name(requirement: str) -> str:
            match = re.match(r"\\s*([A-Za-z0-9_.-]+)", requirement)
            if match is None:
                raise AssertionError(f"Cannot parse requirement name: {requirement!r}")
            return match.group(1).lower().replace("_", "-")


        project_root = Path(sys.argv[1])
        pyproject = tomllib.loads((project_root / "pyproject.toml").read_text())
        default_dependency_names = {
            requirement_name(requirement)
            for requirement in pyproject["project"].get("dependencies", [])
        }
        server_dependency_names = {
            requirement_name(requirement)
            for requirement in pyproject["project"].get("optional-dependencies", {}).get("server", [])
        }
        grpc_dependency_names = {
            requirement_name(requirement)
            for requirement in pyproject["project"].get("optional-dependencies", {}).get("grpc", [])
        }
        server_only_dependency_names = (server_dependency_names | grpc_dependency_names) - default_dependency_names

        agenton_layers = importlib.import_module("agenton.layers")
        agenton_compositor = importlib.import_module("agenton.compositor")
        agenton_collections = importlib.import_module("agenton_collections")
        plain_layers = importlib.import_module("agenton_collections.layers.plain")
        pydantic_ai_layers = importlib.import_module("agenton_collections.layers.pydantic_ai")
        dify_agent = importlib.import_module("dify_agent")
        client_module = importlib.import_module("dify_agent.client")
        protocol_module = importlib.import_module("dify_agent.protocol")
        agent_stub_protocol_module = importlib.import_module("dify_agent.agent_stub.protocol")
        agent_cli_help_module = importlib.import_module("dify_agent.layers._agent_cli_help")
        agent_stub_shell_env_module = importlib.import_module("dify_agent.agent_stub.shell_env")
        shell_module = importlib.import_module("dify_agent.layers.shell")
        drive_module = importlib.import_module("dify_agent.layers.drive")
        execution_context_module = importlib.import_module("dify_agent.layers.execution_context")
        plugin_module = importlib.import_module("dify_agent.layers.dify_plugin")
        ask_human_module = importlib.import_module("dify_agent.layers.ask_human")
        output_module = importlib.import_module("dify_agent.layers.output")

        assert agenton_layers.ExitIntent is not None
        assert agenton_layers.LayerConfig is not None
        assert agenton_compositor.CompositorSessionSnapshot is not None
        assert agenton_collections.PromptLayer is plain_layers.PromptLayer
        assert plain_layers.PromptLayerConfig is not None
        assert pydantic_ai_layers.PydanticAIHistoryLayer is not None
        assert dify_agent.Client is client_module.Client
        assert protocol_module.CreateRunRequest is not None
        assert protocol_module.RunComposition is not None
        assert protocol_module.RunLayerSpec is not None
        assert agent_stub_protocol_module.AgentStubConnectRequest is not None
        assert agent_cli_help_module.render_agent_stub_cli_help is not None
        # Exercises the generated JSON snapshot to confirm it ships in the wheel.
        assert "Usage:" in agent_cli_help_module.render_agent_stub_cli_help(("config",))
        assert agent_stub_shell_env_module.build_shell_agent_stub_env is not None
        assert shell_module.DifyShellLayerConfig is not None
        assert drive_module.DifyDriveLayerConfig is not None
        assert execution_context_module.DifyExecutionContextLayerConfig is not None
        assert plugin_module.DifyPluginLLMLayerConfig is not None
        assert ask_human_module.DifyAskHumanLayerConfig is not None
        assert output_module.DifyOutputLayerConfig is not None

        unexpectedly_installed = []
        for dependency_name in sorted(server_only_dependency_names):
            try:
                distribution(dependency_name)
            except PackageNotFoundError:
                continue
            unexpectedly_installed.append(dependency_name)
        assert unexpectedly_installed == []
        """
    )
    subprocess.run([str(python_path), "-c", script, str(project_root)], cwd=project_root, check=True)

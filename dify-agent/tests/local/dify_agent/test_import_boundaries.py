from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _run_import_check(
    *,
    blocked_imports: list[str],
    imports: list[str],
    assertions: list[str],
    bootstrap: list[str] | None = None,
) -> None:
    python_path = os.pathsep.join([str(PROJECT_ROOT / "src"), os.environ.get("PYTHONPATH", "")])
    module_aliases = {module_name: module_name.replace(".", "_") for module_name in imports}
    script = "\n".join(
        [
            "import builtins",
            "import importlib",
            "import sys",
            f"blocked_imports = {blocked_imports!r}",
            f"imports = {imports!r}",
            f"module_aliases = {module_aliases!r}",
            f"assertions = {assertions!r}",
            "original_import = builtins.__import__",
            "def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):",
            "    for blocked in blocked_imports:",
            "        if name == blocked or name.startswith(f'{blocked}.'):",
            "            raise ModuleNotFoundError(f'blocked import: {name}')",
            "    return original_import(name, globals, locals, fromlist, level)",
            "builtins.__import__ = guarded_import",
            *(bootstrap or []),
            "namespace = {}",
            "for module_name in imports:",
            "    namespace[module_aliases[module_name]] = importlib.import_module(module_name)",
            "for statement in assertions:",
            "    exec(statement, namespace)",
        ]
    )
    env = os.environ.copy()
    env["PYTHONPATH"] = python_path

    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=PROJECT_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def _run_python_script(script: str) -> None:
    python_path = os.pathsep.join([str(PROJECT_ROOT / "src"), os.environ.get("PYTHONPATH", "")])
    env = os.environ.copy()
    env["PYTHONPATH"] = python_path

    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=PROJECT_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def test_dify_agent_root_import_is_client_safe() -> None:
    _run_import_check(
        blocked_imports=[
            "anthropic",
            "dify_agent.adapters.llm",
            "dify_agent.runtime",
            "dify_agent.server",
            "fastapi",
            "google",
            "graphon",
            "openai",
            "pydantic_settings",
            "redis",
        ],
        imports=["dify_agent"],
        assertions=[
            "from dify_agent import Client",
            "assert dify_agent.Client is Client",
            "assert 'Client' in dify_agent.__all__",
        ],
    )


def test_protocol_and_dify_plugin_exports_do_not_import_server_only_modules() -> None:
    _run_import_check(
        blocked_imports=[
            "anthropic",
            "dify_agent.adapters.llm",
            "dify_agent.layers.drive.layer",
            "dify_agent.layers.execution_context.layer",
            "dify_agent.layers.ask_human.layer",
            "dify_agent.layers.dify_plugin.llm_layer",
            "dify_agent.layers.dify_plugin.tools_layer",
            "dify_agent.layers.knowledge.client",
            "dify_agent.layers.knowledge.layer",
            "dify_agent.layers.output.output_layer",
            "dify_agent.layers.shell.layer",
            "dify_agent.runtime",
            "dify_agent.server",
            "fastapi",
            "google",
            "graphon",
            "openai",
            "pydantic_settings",
            "redis",
            "shellctl.client",
            "shellctl.server",
        ],
        imports=[
            "dify_agent.protocol",
            "dify_agent.layers.drive",
            "dify_agent.layers.execution_context",
            "dify_agent.layers.ask_human",
            "dify_agent.layers.dify_plugin",
            "dify_agent.layers.knowledge",
            "dify_agent.layers.output",
            "dify_agent.layers.shell",
        ],
        assertions=[
            "assert hasattr(dify_agent_protocol, 'CreateRunRequest')",
            "assert hasattr(dify_agent_layers_drive, 'DifyDriveLayerConfig')",
            "assert hasattr(dify_agent_layers_execution_context, 'DifyExecutionContextLayerConfig')",
            "assert hasattr(dify_agent_layers_ask_human, 'DifyAskHumanLayerConfig')",
            "assert hasattr(dify_agent_layers_dify_plugin, 'DifyPluginLLMLayerConfig')",
            "assert hasattr(dify_agent_layers_knowledge, 'DifyKnowledgeBaseLayerConfig')",
            "assert hasattr(dify_agent_layers_output, 'DifyOutputLayerConfig')",
            "assert hasattr(dify_agent_layers_shell, 'DifyShellLayerConfig')",
        ],
    )


def test_agent_stub_cli_main_import_is_client_safe() -> None:
    _run_import_check(
        blocked_imports=[
            "dify_agent.server",
            "dify_agent.agent_stub.server",
            "fastapi",
            "google.protobuf",
            "grpclib",
            "jwcrypto",
            "pydantic_settings",
            "redis",
            "shellctl.server",
        ],
        imports=[
            "dify_agent.agent_stub.client",
            "dify_agent.agent_stub.protocol",
            "dify_agent.agent_stub.cli.main",
            "dify_agent.agent_stub.shell_env",
            "dify_agent.layers.shell.layer",
            "dify_agent.runtime.compositor_factory",
        ],
        assertions=[
            "assert hasattr(dify_agent_agent_stub_client, 'request_agent_stub_drive_manifest_sync')",
            "assert hasattr(dify_agent_agent_stub_protocol, 'AgentStubConnectRequest')",
            "assert hasattr(dify_agent_agent_stub_cli_main, 'main')",
            "assert hasattr(dify_agent_agent_stub_shell_env, 'build_shell_agent_stub_env')",
            "assert hasattr(dify_agent_layers_shell_layer, 'DifyShellLayer')",
            "assert hasattr(dify_agent_runtime_compositor_factory, 'create_default_layer_providers')",
        ],
        bootstrap=[
            "import types",
            "if 'graphon.model_runtime.entities.llm_entities' not in sys.modules:",
            "    graphon_module = types.ModuleType('graphon')",
            "    model_runtime_module = types.ModuleType('graphon.model_runtime')",
            "    entities_module = types.ModuleType('graphon.model_runtime.entities')",
            "    llm_entities_module = types.ModuleType('graphon.model_runtime.entities.llm_entities')",
            "    message_entities_module = types.ModuleType('graphon.model_runtime.entities.message_entities')",
            "    llm_entities_module.LLMResultChunk = type('LLMResultChunk', (), {})",
            "    llm_entities_module.LLMUsage = type('LLMUsage', (), {})",
            "    for name in ('AssistantPromptMessage', 'AudioPromptMessageContent', 'DocumentPromptMessageContent', 'ImagePromptMessageContent', 'PromptMessage', 'PromptMessageContentUnionTypes', 'PromptMessageTool', 'SystemPromptMessage', 'TextPromptMessageContent', 'ToolPromptMessage', 'UserPromptMessage', 'VideoPromptMessageContent'):",
            "        setattr(message_entities_module, name, type(name, (), {}))",
            "    sys.modules['graphon'] = graphon_module",
            "    sys.modules['graphon.model_runtime'] = model_runtime_module",
            "    sys.modules['graphon.model_runtime.entities'] = entities_module",
            "    sys.modules['graphon.model_runtime.entities.llm_entities'] = llm_entities_module",
            "    sys.modules['graphon.model_runtime.entities.message_entities'] = message_entities_module",
            "    graphon_module.model_runtime = model_runtime_module",
            "    model_runtime_module.entities = entities_module",
            "    entities_module.llm_entities = llm_entities_module",
            "    entities_module.message_entities = message_entities_module",
            "if 'jsonschema' not in sys.modules:",
            "    jsonschema_module = types.ModuleType('jsonschema')",
            "    jsonschema_exceptions_module = types.ModuleType('jsonschema.exceptions')",
            "    jsonschema_protocols_module = types.ModuleType('jsonschema.protocols')",
            "    jsonschema_validators_module = types.ModuleType('jsonschema.validators')",
            "    class _SchemaError(Exception):",
            "        pass",
            "    class _ValidationError(Exception):",
            "        path = ()",
            "    class _Validator:",
            "        @staticmethod",
            "        def check_schema(schema):",
            "            return None",
            "        def __init__(self, schema):",
            "            self.schema = schema",
            "        def iter_errors(self, value):",
            "            return iter(())",
            "    def _validator_for(schema):",
            "        return _Validator",
            "    jsonschema_module.SchemaError = _SchemaError",
            "    jsonschema_exceptions_module.ValidationError = _ValidationError",
            "    jsonschema_protocols_module.Validator = _Validator",
            "    jsonschema_validators_module.validator_for = _validator_for",
            "    sys.modules['jsonschema'] = jsonschema_module",
            "    sys.modules['jsonschema.exceptions'] = jsonschema_exceptions_module",
            "    sys.modules['jsonschema.protocols'] = jsonschema_protocols_module",
            "    sys.modules['jsonschema.validators'] = jsonschema_validators_module",
        ],
    )


def test_agent_stub_cli_help_render_does_not_load_server_modules() -> None:
    blocked_modules = [
        "dify_agent.server",
        "dify_agent.agent_stub.server",
        "fastapi",
        "google.protobuf",
        "grpclib",
        "jwcrypto",
        "pydantic_settings",
        "redis",
        "shellctl.server",
    ]
    script = "\n".join(
        [
            "import click",
            "import importlib",
            "import os",
            "import sys",
            "from typer.main import get_command",
            f"blocked_modules = {blocked_modules!r}",
            'original_disable_plugins = os.environ.get("PYDANTIC_DISABLE_PLUGINS")',
            'original_disable_plugins_present = "PYDANTIC_DISABLE_PLUGINS" in os.environ',
            'module = importlib.import_module("dify_agent.agent_stub.cli.main")',
            "command = get_command(module.app)",
            "help_text = command.get_help(click.Context(command))",
            'assert "Forward shell-visible dify-agent commands" in help_text',
            "if original_disable_plugins_present:",
            '    assert os.environ.get("PYDANTIC_DISABLE_PLUGINS") == original_disable_plugins',
            "else:",
            '    assert "PYDANTIC_DISABLE_PLUGINS" not in os.environ',
            "loaded_blocked = sorted(",
            "    name",
            "    for name in sys.modules",
            '    if any(name == blocked or name.startswith(f"{blocked}.") for blocked in blocked_modules)',
            ")",
            "assert loaded_blocked == [], loaded_blocked",
        ]
    )
    _run_python_script(script)


def test_shellctl_client_imports_do_not_import_server_modules() -> None:
    _run_import_check(
        blocked_imports=[
            "aiosqlite",
            "fastapi",
            "sqlalchemy",
            "sqlmodel",
            "shellctl.server.api",
            "shellctl.server.service",
            "shellctl.server.tmux",
            "uvicorn",
        ],
        imports=["shellctl", "shellctl.client", "shellctl.shared", "shellctl.cli"],
        assertions=[
            "assert hasattr(shellctl, 'ShellctlClient')",
            "assert hasattr(shellctl_client, 'ShellctlClient')",
            "assert hasattr(shellctl_shared, 'JobResult')",
            "assert hasattr(shellctl_cli, 'cli')",
        ],
    )


def test_server_settings_import_does_not_import_agent_stub_app() -> None:
    try:
        __import__("pydantic_settings")
        __import__("jwcrypto")
    except ModuleNotFoundError:
        pytest.skip("server extras are not installed in this environment")

    _run_import_check(
        blocked_imports=["dify_agent.agent_stub.server.app"],
        imports=["dify_agent.server.settings"],
        assertions=["assert hasattr(dify_agent_server_settings, 'ServerSettings')"],
    )


def test_agenton_collection_roots_do_not_eagerly_import_pydantic_ai_implementations() -> None:
    _run_import_check(
        blocked_imports=[
            "agenton_collections.layers.pydantic_ai",
            "agenton_collections.transformers.pydantic_ai",
        ],
        imports=["agenton_collections", "agenton_collections.transformers"],
        assertions=[
            "assert 'PydanticAIBridgeLayer' not in agenton_collections.__all__",
            "assert agenton_collections_transformers.__all__ == []",
        ],
    )

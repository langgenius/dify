from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _run_import_check(*, blocked_imports: list[str], imports: list[str], assertions: list[str]) -> None:
    python_path = os.pathsep.join([str(PROJECT_ROOT / "src"), os.environ.get("PYTHONPATH", "")])
    module_aliases = {module_name: module_name.replace(".", "_") for module_name in imports}
    script = "\n".join(
        [
            "import builtins",
            "import importlib",
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
            "assert dify_agent.__all__ == ['Client']",
            "assert dify_agent.Client is Client",
            "assert not hasattr(dify_agent, 'DifyLLMAdapterModel')",
            "assert not hasattr(dify_agent, 'DifyPluginDaemonProvider')",
        ],
    )


def test_protocol_and_dify_plugin_exports_do_not_import_server_only_modules() -> None:
    _run_import_check(
        blocked_imports=[
            "anthropic",
            "dify_agent.adapters.llm",
            "dify_agent.layers.dify_plugin.llm_layer",
            "dify_agent.layers.dify_plugin.plugin_layer",
            "dify_agent.layers.output.output_layer",
            "dify_agent.runtime",
            "dify_agent.server",
            "fastapi",
            "google",
            "graphon",
            "openai",
            "pydantic_settings",
            "redis",
        ],
        imports=["dify_agent.protocol", "dify_agent.layers.dify_plugin", "dify_agent.layers.output"],
        assertions=[
            "assert hasattr(dify_agent_protocol, 'PydanticAIStreamRunEvent')",
            "assert dify_agent_layers_dify_plugin.__all__ == ['DIFY_PLUGIN_LAYER_TYPE_ID', 'DIFY_PLUGIN_LLM_LAYER_TYPE_ID', 'DifyPluginCredentialValue', 'DifyPluginLLMLayerConfig', 'DifyPluginLayerConfig']",
            "assert dify_agent_layers_output.__all__ == ['DIFY_OUTPUT_LAYER_TYPE_ID', 'DifyOutputLayerConfig']",
        ],
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

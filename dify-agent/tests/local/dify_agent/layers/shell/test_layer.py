import asyncio
import json
import shutil
from pathlib import Path
from uuid import uuid4

import pytest
from agenton.compositor import Compositor, LayerNode, LayerProvider
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
from dify_agent.layers.shell import DifyShellLayerConfig
from dify_agent.layers.shell.layer import DifyShellLayer, ShellCommandTimeoutError


def _compositor() -> Compositor[object, object, object, object, object, object]:
    execution_context_provider = LayerProvider.from_factory(
        layer_type=DifyExecutionContextLayer,
        create=lambda config: DifyExecutionContextLayer.from_config_with_settings(
            DifyExecutionContextLayerConfig.model_validate(config),
            daemon_url="http://plugin-daemon",
            daemon_api_key="daemon-secret",
        ),
    )
    shell_provider = LayerProvider.from_layer_type(DifyShellLayer)
    return Compositor(
        [
            LayerNode("execution_context", execution_context_provider),
            LayerNode("shell", shell_provider, deps={"execution_context": "execution_context"}),
        ]
    )


def test_shell_layer_run_ephemeral_command_runs_inside_workspace_and_injects_stub_env() -> None:
    async def scenario() -> None:
        async with _compositor().enter(
            configs={
                "execution_context": DifyExecutionContextLayerConfig(
                    tenant_id="tenant-1",
                    workflow_run_id="workflow-run-1",
                    invoke_from="workflow_run",
                ),
                "shell": DifyShellLayerConfig(),
            }
        ) as run:
            shell = run.get_layer("shell", DifyShellLayer)
            run.suspend_on_exit()

            result = await shell.run_ephemeral_command(
                "python - <<'PY'\nimport json\nimport os\nprint(json.dumps({'cwd': os.getcwd(), 'tenant': os.environ['DIFY_AGENT_STUB_TENANT_ID']}), end='')\nPY",
                timeout=5.0,
            )

            payload = json.loads(result.stdout)
            assert result.exit_code == 0
            assert Path(payload["cwd"]) == shell.workspace_path
            assert payload["tenant"] == "tenant-1"

    asyncio.run(scenario())


def test_shell_layer_run_ephemeral_command_does_not_mutate_job_tracking_on_failure() -> None:
    async def scenario() -> None:
        async with _compositor().enter(
            configs={
                "execution_context": DifyExecutionContextLayerConfig(tenant_id="tenant-1", invoke_from="workflow_run"),
                "shell": DifyShellLayerConfig(),
            }
        ) as run:
            shell = run.get_layer("shell", DifyShellLayer)
            run.suspend_on_exit()

            result = await shell.run_ephemeral_command("python - <<'PY'\nraise SystemExit(7)\nPY", timeout=5.0)

            assert result.exit_code == 7
            assert shell.runtime_state.job_ids == []
            assert shell.runtime_state.job_offsets == {}

    asyncio.run(scenario())


def test_shell_layer_run_ephemeral_command_raises_timeout_without_polluting_job_tracking() -> None:
    async def scenario() -> None:
        async with _compositor().enter(
            configs={
                "execution_context": DifyExecutionContextLayerConfig(tenant_id="tenant-1", invoke_from="workflow_run"),
                "shell": DifyShellLayerConfig(),
            }
        ) as run:
            shell = run.get_layer("shell", DifyShellLayer)
            run.suspend_on_exit()

            try:
                await shell.run_ephemeral_command(
                    "python - <<'PY'\nimport time\ntime.sleep(0.2)\nPY",
                    timeout=0.01,
                )
            except ShellCommandTimeoutError:
                pass
            else:
                raise AssertionError("Expected ShellCommandTimeoutError")

            assert shell.runtime_state.job_ids == []
            assert shell.runtime_state.job_offsets == {}

    asyncio.run(scenario())


def test_shell_layer_workspace_path_rejects_unmanaged_runtime_state() -> None:
    shell = DifyShellLayer.from_config(DifyShellLayerConfig())
    shell.runtime_state.session_id = "session-1"
    shell.runtime_state.workspace_cwd = "/etc"

    with pytest.raises(RuntimeError, match="managed sandbox root"):
        _ = shell.workspace_path


def test_shell_layer_workspace_path_rejects_invalid_session_id() -> None:
    shell = DifyShellLayer.from_config(DifyShellLayerConfig())
    shell.runtime_state.session_id = ".."
    shell.runtime_state.workspace_cwd = str(DifyShellLayer.managed_root().parent)

    with pytest.raises(RuntimeError, match="session_id is invalid"):
        _ = shell.workspace_path


def test_shell_layer_resume_rejects_missing_workspace() -> None:
    async def scenario() -> None:
        shell = DifyShellLayer.from_config(DifyShellLayerConfig())
        await shell.on_context_create()
        workspace = shell.workspace_path
        shutil.rmtree(workspace)

        with pytest.raises(RuntimeError, match="no longer exists"):
            await shell.on_context_resume()

    asyncio.run(scenario())


def test_shell_layer_run_ephemeral_command_passes_extra_env_without_shell_expansion() -> None:
    marker = Path("/tmp/opencode") / f"shell-extra-env-{uuid4()}"

    async def scenario() -> None:
        async with _compositor().enter(
            configs={
                "execution_context": DifyExecutionContextLayerConfig(tenant_id="tenant-1", invoke_from="workflow_run"),
                "shell": DifyShellLayerConfig(),
            }
        ) as run:
            shell = run.get_layer("shell", DifyShellLayer)
            run.suspend_on_exit()

            result = await shell.run_ephemeral_command(
                "python - <<'PY'\nimport json\nimport os\nprint(json.dumps({'value': os.environ['DIFY_TEST_VALUE']}), end='')\nPY",
                timeout=5.0,
                extra_env={"DIFY_TEST_VALUE": f"$(touch {marker})"},
            )

            assert json.loads(result.stdout) == {"value": f"$(touch {marker})"}
            assert not marker.exists()

    asyncio.run(scenario())

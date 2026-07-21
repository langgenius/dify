from __future__ import annotations

import pytest
from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from agenton_collections.layers.plain import PromptLayerConfig
from dify_agent.layers.dify_core_tools import DIFY_CORE_TOOLS_LAYER_TYPE_ID
from dify_agent.layers.dify_plugin import DIFY_PLUGIN_LLM_LAYER_TYPE_ID
from dify_agent.layers.execution_context import DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID, DifyExecutionContextLayerConfig
from dify_agent.layers.home import DIFY_HOME_LAYER_TYPE_ID, DifyHomeLayerConfig
from dify_agent.layers.sandbox import DIFY_SANDBOX_LAYER_TYPE_ID, DifySandboxLayerConfig
from dify_agent.layers.shell import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig
from dify_agent.layers.workspace import DIFY_WORKSPACE_LAYER_TYPE_ID, DifyWorkspaceLayerConfig
from dify_agent.protocol import (
    CreateRunRequest,
    RunComposition,
    RunLayerSpec,
    RuntimeLayerSpec,
    build_sandbox_locator_from_layer_specs,
    build_sandbox_locator_from_run_request,
    extract_runtime_layer_specs,
)


def _request() -> CreateRunRequest:
    composition = RunComposition(
        layers=[
            RunLayerSpec(name="prompt", type="plain.prompt", config=PromptLayerConfig(prefix="hi")),
            RunLayerSpec(
                name="execution_context",
                type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                config=DifyExecutionContextLayerConfig(
                    tenant_id="tenant-1",
                    user_from="account",
                    agent_mode="workflow_run",
                    invoke_from="service-api",
                ),
            ),
            RunLayerSpec(name="llm", type=DIFY_PLUGIN_LLM_LAYER_TYPE_ID),
            RunLayerSpec(
                name="home",
                type=DIFY_HOME_LAYER_TYPE_ID,
                deps={"execution_context": "execution_context"},
                config=DifyHomeLayerConfig(snapshot_ref="home-ref"),
            ),
            RunLayerSpec(
                name="workspace",
                type=DIFY_WORKSPACE_LAYER_TYPE_ID,
                deps={"execution_context": "execution_context"},
                config=DifyWorkspaceLayerConfig(workspace_id="session-1"),
            ),
            RunLayerSpec(
                name="sandbox",
                type=DIFY_SANDBOX_LAYER_TYPE_ID,
                deps={"execution_context": "execution_context", "home": "home", "workspace": "workspace"},
                config=DifySandboxLayerConfig(),
            ),
            RunLayerSpec(
                name="shell",
                type=DIFY_SHELL_LAYER_TYPE_ID,
                deps={"execution_context": "execution_context", "sandbox": "sandbox"},
                config=DifyShellLayerConfig(),
            ),
        ]
    )
    snapshot = CompositorSessionSnapshot(
        layers=[
            LayerSessionSnapshot(name="prompt", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
            LayerSessionSnapshot(
                name="execution_context",
                lifecycle_state=LifecycleState.SUSPENDED,
                runtime_state={},
            ),
            LayerSessionSnapshot(name="llm", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
            LayerSessionSnapshot(name="home", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
            LayerSessionSnapshot(name="workspace", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
            LayerSessionSnapshot(
                name="sandbox", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={"handle": "sandbox-1"}
            ),
            LayerSessionSnapshot(
                name="shell",
                lifecycle_state=LifecycleState.SUSPENDED,
                runtime_state={},
            ),
        ]
    )
    return CreateRunRequest(composition=composition, session_snapshot=snapshot)


def test_build_sandbox_locator_from_run_request_filters_to_runtime_resource_layers() -> None:
    locator = build_sandbox_locator_from_run_request(_request())

    assert [layer.name for layer in locator.composition.layers] == [
        "execution_context",
        "home",
        "workspace",
        "sandbox",
    ]
    assert [layer.type for layer in locator.composition.layers] == [
        DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
        DIFY_HOME_LAYER_TYPE_ID,
        DIFY_WORKSPACE_LAYER_TYPE_ID,
        DIFY_SANDBOX_LAYER_TYPE_ID,
    ]
    assert [layer.name for layer in locator.session_snapshot.layers] == [
        "execution_context",
        "home",
        "workspace",
        "sandbox",
    ]


def test_build_sandbox_locator_from_run_request_rejects_missing_session_snapshot() -> None:
    request = _request()
    request.session_snapshot = None

    with pytest.raises(ValueError, match="session_snapshot"):
        build_sandbox_locator_from_run_request(request)


def test_extract_runtime_layer_specs_drops_sensitive_plugin_layers() -> None:
    specs = extract_runtime_layer_specs(_request().composition)

    assert [spec.name for spec in specs] == [
        "prompt",
        "execution_context",
        "home",
        "workspace",
        "sandbox",
        "shell",
    ]


def _runtime_specs(*, shell_execution_context: str = "execution_context") -> list[RuntimeLayerSpec]:
    return [
        RuntimeLayerSpec(name="execution_context", type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID),
        RuntimeLayerSpec(name="home", type=DIFY_HOME_LAYER_TYPE_ID, deps={"execution_context": "execution_context"}),
        RuntimeLayerSpec(
            name="workspace", type=DIFY_WORKSPACE_LAYER_TYPE_ID, deps={"execution_context": "execution_context"}
        ),
        RuntimeLayerSpec(
            name="sandbox",
            type=DIFY_SANDBOX_LAYER_TYPE_ID,
            deps={"execution_context": "execution_context", "home": "home", "workspace": "workspace"},
        ),
        RuntimeLayerSpec(
            name="shell",
            type=DIFY_SHELL_LAYER_TYPE_ID,
            deps={"execution_context": shell_execution_context, "sandbox": "sandbox"},
        ),
    ]


def _runtime_snapshot_layers() -> list[LayerSessionSnapshot]:
    return [
        LayerSessionSnapshot(name=name, lifecycle_state=LifecycleState.SUSPENDED, runtime_state={})
        for name in ("execution_context", "home", "workspace", "sandbox", "shell")
    ]


def test_build_sandbox_locator_from_layer_specs_does_not_require_shell() -> None:
    locator = build_sandbox_locator_from_layer_specs(
        layer_specs=_runtime_specs()[:-1],
        session_snapshot=CompositorSessionSnapshot(layers=_runtime_snapshot_layers()[:-1]),
    )

    assert [layer.name for layer in locator.composition.layers] == [
        "execution_context",
        "home",
        "workspace",
        "sandbox",
    ]


def test_build_sandbox_locator_from_layer_specs_rejects_missing_snapshot_layer() -> None:
    specs = _runtime_specs()

    with pytest.raises(ValueError, match="session_snapshot"):
        build_sandbox_locator_from_layer_specs(
            layer_specs=specs,
            session_snapshot=CompositorSessionSnapshot(
                layers=[
                    LayerSessionSnapshot(
                        name="execution_context", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}
                    )
                ]
            ),
        )


def test_build_sandbox_locator_ignores_unneeded_shell_dep_mismatch() -> None:
    specs = _runtime_specs(shell_execution_context="wrong-layer")

    locator = build_sandbox_locator_from_layer_specs(
        layer_specs=specs,
        session_snapshot=CompositorSessionSnapshot(layers=_runtime_snapshot_layers()),
    )

    assert [layer.name for layer in locator.composition.layers] == [
        "execution_context",
        "home",
        "workspace",
        "sandbox",
    ]


def test_build_sandbox_locator_from_layer_specs_rejects_order_mismatch() -> None:
    specs = _runtime_specs()

    with pytest.raises(ValueError, match="in order"):
        build_sandbox_locator_from_layer_specs(
            layer_specs=specs,
            session_snapshot=CompositorSessionSnapshot(layers=list(reversed(_runtime_snapshot_layers()))),
        )


def test_build_sandbox_locator_from_layer_specs_rejects_sensitive_runtime_specs() -> None:
    with pytest.raises(ValueError, match="sensitive"):
        build_sandbox_locator_from_layer_specs(
            layer_specs=[RuntimeLayerSpec(name="llm", type=DIFY_PLUGIN_LLM_LAYER_TYPE_ID)],
            session_snapshot=CompositorSessionSnapshot(layers=[]),
        )


def test_build_sandbox_locator_from_layer_specs_rejects_sensitive_core_tool_runtime_specs() -> None:
    with pytest.raises(ValueError, match="sensitive"):
        build_sandbox_locator_from_layer_specs(
            layer_specs=[RuntimeLayerSpec(name="core_tools", type=DIFY_CORE_TOOLS_LAYER_TYPE_ID)],
            session_snapshot=CompositorSessionSnapshot(layers=[]),
        )

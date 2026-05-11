"""Synchronous Python client example for the Dify Agent run server.

Requires the same running FastAPI server as the async examples. ``create_run_sync``
does not retry ``POST /runs``; if a timeout occurs, inspect server state or create
a new run explicitly rather than assuming the original request was not accepted.
"""

from agenton.compositor import CompositorConfig, LayerNodeConfig
from agenton_collections.layers.plain import PromptLayerConfig
from dify_agent.client import Client
from dify_agent.layers.dify_plugin import (
    DifyPluginCredentialValue,
    DifyPluginLLMLayerConfig,
    DifyPluginLayerConfig,
)
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID, CreateRunRequest


API_BASE_URL = "http://localhost:8000"
TENANT_ID = "replace-with-tenant-id"
PLUGIN_ID = "langgenius/openai"
PLUGIN_PROVIDER = "openai"
MODEL_NAME = "gpt-4o-mini"
MODEL_CREDENTIALS: dict[str, DifyPluginCredentialValue] = {"api_key": "replace-with-provider-key"}


def main() -> None:
    with Client(base_url=API_BASE_URL) as client:
        run = client.create_run_sync(
            CreateRunRequest(
                compositor=CompositorConfig(
                    layers=[
                        LayerNodeConfig(
                            name="prompt",
                            type="plain.prompt",
                            config=PromptLayerConfig(
                                prefix="You are a concise assistant.",
                                user="Say hello from the synchronous Dify Agent client example.",
                            ),
                        ),
                        LayerNodeConfig(
                            name="plugin",
                            type="dify.plugin",
                            config=DifyPluginLayerConfig(tenant_id=TENANT_ID, plugin_id=PLUGIN_ID),
                        ),
                        LayerNodeConfig(
                            name=DIFY_AGENT_MODEL_LAYER_ID,
                            type="dify.plugin.llm",
                            deps={"plugin": "plugin"},
                            config=DifyPluginLLMLayerConfig(
                                model_provider=PLUGIN_PROVIDER,
                                model=MODEL_NAME,
                                credentials=MODEL_CREDENTIALS,
                            ),
                        ),
                    ],
                ),
            )
        )
        print("created run", run)
        terminal = client.wait_run_sync(run.run_id, poll_interval_seconds=0.5)
        print("terminal status", terminal)


if __name__ == "__main__":
    main()

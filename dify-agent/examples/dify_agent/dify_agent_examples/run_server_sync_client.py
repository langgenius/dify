"""Synchronous Python client example for the Dify Agent run server.

Requires the same running FastAPI server as the async examples. Before starting
that server, sync the server runtime dependencies with
`uv sync --project dify-agent --extra server` or install
`dify-agent[server]`. ``create_run_sync`` does not retry ``POST /runs``; if a
timeout occurs, inspect server state or create a new run explicitly rather than
assuming the original request was not accepted.
"""

from agenton_collections.layers.plain import PLAIN_PROMPT_LAYER_TYPE_ID, PromptLayerConfig
from dify_agent.client import Client
from dify_agent.layers.execution_context import DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID, DifyExecutionContextLayerConfig
from dify_agent.layers.dify_plugin import (
    DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
    DifyPluginCredentialValue,
    DifyPluginLLMLayerConfig,
)
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID, CreateRunRequest, RunComposition, RunLayerSpec


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
                composition=RunComposition(
                    layers=[
                        RunLayerSpec(
                            name="prompt",
                            type=PLAIN_PROMPT_LAYER_TYPE_ID,
                            config=PromptLayerConfig(
                                prefix="You are a concise assistant.",
                                user="Say hello from the synchronous Dify Agent client example.",
                            ),
                        ),
                        RunLayerSpec(
                            name="execution_context",
                            type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                            config=DifyExecutionContextLayerConfig(
                                tenant_id=TENANT_ID,
                                user_from="account",
                                agent_mode="workflow_run",
                                invoke_from="service-api",
                            ),
                        ),
                        RunLayerSpec(
                            name=DIFY_AGENT_MODEL_LAYER_ID,
                            type=DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
                            deps={"execution_context": "execution_context"},
                            config=DifyPluginLLMLayerConfig(
                                plugin_id=PLUGIN_ID,
                                model_provider=PLUGIN_PROVIDER,
                                model=MODEL_NAME,
                                credentials=MODEL_CREDENTIALS,
                            ),
                        ),
                        # Minimal plugin-tools example. API callers should pass
                        # prepared parameters + JSON schema instead of relying on
                        # dify-agent to fetch and merge daemon declarations.
                        # from dify_agent.layers.dify_plugin import (
                        #     DifyPluginToolConfig,
                        #     DifyPluginToolParameter,
                        #     DifyPluginToolParameterForm,
                        #     DifyPluginToolParameterType,
                        #     DifyPluginToolsLayerConfig,
                        # )
                        # RunLayerSpec(
                        #     name="tools",
                        #     type="dify.plugin.tools",
                        #     deps={"execution_context": "execution_context"},
                        #     config=DifyPluginToolsLayerConfig(
                        #         tools=[
                        #             DifyPluginToolConfig(
                        #                 plugin_id="langgenius/search",
                        #                 provider="search",
                        #                 tool_name="web_search",
                        #                 credential_type="api-key",
                        #                 credentials={"api_key": "replace-with-tool-key"},
                        #                 runtime_parameters={"site": "docs.dify.ai"},
                        #                 parameters=[
                        #                     DifyPluginToolParameter(
                        #                         name="query",
                        #                         type=DifyPluginToolParameterType.STRING,
                        #                         form=DifyPluginToolParameterForm.LLM,
                        #                         required=True,
                        #                         llm_description="Search query",
                        #                     ),
                        #                 ],
                        #                 parameters_json_schema={
                        #                     "type": "object",
                        #                     "properties": {
                        #                         "query": {"type": "string", "description": "Search query"}
                        #                     },
                        #                     "required": ["query"],
                        #                 },
                        #             )
                        #         ]
                        #     ),
                        # ),
                    ],
                ),
            )
        )
        print("created run", run)
        terminal = client.wait_run_sync(run.run_id, poll_interval_seconds=0.5)
        print("terminal status", terminal)


if __name__ == "__main__":
    main()

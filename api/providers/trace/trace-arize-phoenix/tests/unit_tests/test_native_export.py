"""OpenInference's native message and model fields are provider-owned."""

import json
from urllib.parse import parse_qs, urlsplit

import pytest
from dify_trace_arize_phoenix.arize_phoenix_trace import create_trace_client

from tests.unit_tests.core.ops.test_provider_export import make_completed_trace, provider_config


@pytest.mark.parametrize(
    ("provider", "expected_location"),
    [("arize", "https://app.arize.com/"), ("phoenix", "https://phoenix.example/projects/")],
)
def test_project_link_redirects_by_project_name(provider: str, expected_location: str) -> None:
    project = "Support / production & 研发"
    client = create_trace_client(provider, {**provider_config(provider), "project": project})
    url = urlsplit(client.get_project_url())
    assert f"{url.scheme}://{url.netloc}{url.path}" == expected_location
    assert parse_qs(url.query) == {"redirect_project_name": [project]}
    assert not url.fragment


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
def test_messages_tool_calls_parameters_metadata_and_text_mime_types(provider: str) -> None:
    trace = make_completed_trace()
    model = trace.spans[-1].model_copy(
        update={
            "inputs": [
                {"role": "system", "text": "Help the user"},
                {
                    "role": "assistant",
                    "tool_calls": [{"id": "call-1", "function": {"name": "search", "arguments": '{"q":"dify"}'}}],
                },
                {"role": "tool", "tool_call_id": "call-1", "text": "Found"},
            ],
            "outputs": "Answer",
            "source_workflow_version": "v2",
            "attributes": {
                "model_name": "model",
                "model_provider": "provider",
                "model_parameters": {"temperature": 0.2},
                "tags": ["production"],
            },
        }
    )
    attributes = {
        item.key: item.value
        for item in create_trace_client(provider, provider_config(provider)).build_span(trace, model).attributes
    }
    assert attributes["openinference.span.kind"].string_value == "LLM"
    assert attributes["llm.input_messages.0.message.role"].string_value == "system"
    assert attributes["llm.input_messages.0.message.content"].string_value == "Help the user"
    assert attributes["llm.input_messages.1.message.tool_calls.0.tool_call.id"].string_value == "call-1"
    assert attributes["llm.input_messages.1.message.tool_calls.0.tool_call.function.name"].string_value == "search"
    assert json.loads(
        attributes["llm.input_messages.1.message.tool_calls.0.tool_call.function.arguments"].string_value
    ) == {"q": "dify"}
    assert attributes["llm.input_messages.2.message.tool_call_id"].string_value == "call-1"
    assert attributes["llm.output_messages.0.message.content"].string_value == "Answer"
    assert attributes["llm.provider"].string_value == "provider"
    assert attributes["llm.model_name"].string_value == "model"
    assert json.loads(attributes["llm.invocation_parameters"].string_value) == {"temperature": 0.2}
    assert attributes["output.mime_type"].string_value == "text/plain"
    assert attributes["tag.tags"].array_value.values[0].string_value == "production"
    metadata = json.loads(attributes["metadata"].string_value)
    assert metadata["dify.tenant_id"] == trace.source.tenant_id
    assert metadata["dify.workflow.version"] == "v2"
    assert attributes["llm.cost.total"].double_value == 0.02

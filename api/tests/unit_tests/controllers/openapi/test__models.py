import pytest
from pydantic import BaseModel

from controllers.openapi._models import AgentRunPayload, AppDescribeResponse, ChatRunPayload


def test_describe_response_all_blocks_optional() -> None:
    payload = AppDescribeResponse().model_dump(mode="json", exclude_none=False)
    assert payload == {"info": None, "parameters": None, "input_schema": None, "hints": []}


@pytest.mark.parametrize(
    ("payload", "describe_op"),
    [(AgentRunPayload, "describe.agent"), (ChatRunPayload, "describe.console_app")],
    ids=["agent", "app"],
)
def test_run_inputs_point_at_the_describe_op_of_their_resource(payload: type[BaseModel], describe_op: str) -> None:
    description = payload.model_json_schema()["properties"]["inputs"]["description"]

    assert f"from {describe_op}." in description


def test_agent_run_inputs_keep_the_run_inputs_shape() -> None:
    agent = AgentRunPayload.model_json_schema()["properties"]["inputs"]
    chat = ChatRunPayload.model_json_schema()["properties"]["inputs"]

    assert {key: value for key, value in agent.items() if key != "description"} == {
        key: value for key, value in chat.items() if key != "description"
    }

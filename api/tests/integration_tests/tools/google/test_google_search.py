import pytest

from core.tools.provider.builtin.google.google import GoogleProvider
from core.tools.provider.assistant_tool import AssistantTool
from core.tools.errors import AssistantToolParamterValidationError

def test_google_search():
    provider = GoogleProvider()

    tools = provider.get_tools()

    tool: AssistantTool = tools[0]
    result = provider.invoke(
        tool_id=0,
        tool_name=tool.identity.name,
        tool_parameters={
        "query": "test",
        "result_type": "link",
    }, credentials={

    }, prompt_messages=[])

    with pytest.raises(AssistantToolParamterValidationError):
        result = provider.invoke(
            tool_id=0,
            tool_name=tool.identity.name,
            tool_parameters={
            "result_type": "link",
        }, credentials={

        }, prompt_messages=[])

    assert len(result) > 0
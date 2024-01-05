import pytest

from core.tools.provider.builtin.google.google import GoogleProvider
from core.tools.provider.tool import Tool
from core.tools.errors import ToolParamterValidationError

def test_google_search():
    provider = GoogleProvider()

    tools = provider.get_tools()

    tool: Tool = tools[0]
    result = provider.invoke(
        tool_id=0,
        tool_name=tool.identity.name,
        tool_parameters={
        "query": "test",
        "result_type": "link",
    }, credentials={

    }, prompt_messages=[])

    with pytest.raises(ToolParamterValidationError):
        result = provider.invoke(
            tool_id=0,
            tool_name=tool.identity.name,
            tool_parameters={
            "result_type": "link",
        }, credentials={

        }, prompt_messages=[])

    assert len(result) > 0
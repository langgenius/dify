from core.tools.provider.builtin.google.google import GoogleProvider
from core.tools.provider.assistant_tool import AssistantTool

def test_google_search():
    provider = GoogleProvider()

    tools = provider.get_tools()

    tool: AssistantTool = tools[0]
    result = tool.invoke(tool_paramters={
        "query": "test",
        "result_type": "link",
    }, credentials={

    }, prompt_messages=[])

    assert len(result) > 0
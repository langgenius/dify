from core.tools.provider.builtin.dalle.dalle import DALLEProvider
from core.tools.entities.assistant_entities import AssistantAppMessage, AssistantAppType
from core.tools.provider.assistant_tool import AssistantTool

def test_dalle_draw():
    provider = DALLEProvider()

    tools = provider.get_tools()

    tool: AssistantTool = tools[0]

    tool.invoke(tool_paramters={

    }, credentials={

    }, prompt_messages=[])
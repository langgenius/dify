from core.tools.provider.builtin.dalle.dalle import DALLEProvider
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.tool.tool import Tool

def test_dalle_draw():
    provider = DALLEProvider()

    tools = provider.get_tools()

    tool: Tool = tools[0]

    tool.invoke(tool_paramters={

    }, credentials={

    }, prompt_messages=[])
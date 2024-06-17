from core.tools.tool.api_tool import ApiTool
from core.tools.tool.tool import Tool

tool_bundle = {
    'server_url': 'http://www.example.com',
    'method': 'get',
    'author': '',
    'openapi': {},
    'parameters': []
}


def test_get():
    tool = ApiTool(api_bundle=tool_bundle, runtime=Tool.Runtime(credentials={'auth_type': 'none'}))
    res = tool.validate_credentials(credentials={}, parameters={'location': '123'})
    print(res)

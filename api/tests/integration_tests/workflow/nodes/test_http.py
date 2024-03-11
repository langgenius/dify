from calendar import c
import pytest
from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.http_request.entities import HttpRequestNodeData
from core.workflow.nodes.http_request.http_request_node import HttpRequestNode

from tests.integration_tests.workflow.nodes.__mock.http import setup_http_mock

BASIC_NODE_DATA = {
    'tenant_id': '1',
    'app_id': '1',
    'workflow_id': '1',
    'user_id': '1',
    'user_from': InvokeFrom.WEB_APP,
}

# construct variable pool
pool = VariablePool(system_variables={}, user_inputs={})
pool.append_variable(node_id='1', variable_key_list=['123', 'args1'], value=1)
pool.append_variable(node_id='1', variable_key_list=['123', 'args2'], value=2)

@pytest.mark.parametrize('setup_http_mock', [['none']], indirect=True)
def test_get_param(setup_http_mock):
    node = HttpRequestNode(config={
        'id': '1',
        'data': {
            'title': 'http',
            'desc': '',
            'variables': [],
            'method': 'get',
            'url': 'http://example.com',
            'authorization': {
                'type': 'api-key',
                'config': {
                    'type': 'basic',
                    'api_key':'ak-xxx',
                    'header': 'api-key',
                }
            },
            'headers': '',
            'params': '',
            'body': None,
        }
    }, **BASIC_NODE_DATA)

    result = node.run(pool)

    print(result)

    assert 1==2
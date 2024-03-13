from calendar import c
import pytest
from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.variable_pool import VariablePool
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
def test_get(setup_http_mock):
    node = HttpRequestNode(config={
        'id': '1',
        'data': {
            'title': 'http',
            'desc': '',
            'variables': [{
                'variable': 'args1',
                'value_selector': ['1', '123', 'args1'],
            }],
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
            'headers': 'X-Header:123',
            'params': 'A:b',
            'body': None,
        }
    }, **BASIC_NODE_DATA)

    result = node.run(pool)

    data = result.process_data.get('request', '')

    assert '?A=b' in data
    assert 'api-key: Basic ak-xxx' in data
    assert 'X-Header: 123' in data

@pytest.mark.parametrize('setup_http_mock', [['none']], indirect=True)
def test_no_auth(setup_http_mock):
    node = HttpRequestNode(config={
        'id': '1',
        'data': {
            'title': 'http',
            'desc': '',
            'variables': [{
                'variable': 'args1',
                'value_selector': ['1', '123', 'args1'],
            }],
            'method': 'get',
            'url': 'http://example.com',
            'authorization': {
                'type': 'no-auth',
                'config': None,
            },
            'headers': 'X-Header:123',
            'params': 'A:b',
            'body': None,
        }
    }, **BASIC_NODE_DATA)

    result = node.run(pool)

    data = result.process_data.get('request', '')

    assert '?A=b' in data
    assert 'X-Header: 123' in data

@pytest.mark.parametrize('setup_http_mock', [['none']], indirect=True)
def test_template(setup_http_mock):
    node = HttpRequestNode(config={
        'id': '1',
        'data': {
            'title': 'http',
            'desc': '',
            'variables': [{
                'variable': 'args1',
                'value_selector': ['1', '123', 'args2'],
            }],
            'method': 'get',
            'url': 'http://example.com/{{args1}}',
            'authorization': {
                'type': 'api-key',
                'config': {
                    'type': 'basic',
                    'api_key':'ak-xxx',
                    'header': 'api-key',
                }
            },
            'headers': 'X-Header:123\nX-Header2:{{args1}}',
            'params': 'A:b\nTemplate:{{args1}}',
            'body': None,
        }
    }, **BASIC_NODE_DATA)

    result = node.run(pool)
    data = result.process_data.get('request', '')

    assert '?A=b' in data
    assert 'Template=2' in data
    assert 'api-key: Basic ak-xxx' in data
    assert 'X-Header: 123' in data
    assert 'X-Header2: 2' in data

@pytest.mark.parametrize('setup_http_mock', [['none']], indirect=True)
def test_json(setup_http_mock):
    node = HttpRequestNode(config={
        'id': '1',
        'data': {
            'title': 'http',
            'desc': '',
            'variables': [{
                'variable': 'args1',
                'value_selector': ['1', '123', 'args1'],
            }],
            'method': 'post',
            'url': 'http://example.com',
            'authorization': {
                'type': 'api-key',
                'config': {
                    'type': 'basic',
                    'api_key':'ak-xxx',
                    'header': 'api-key',
                }
            },
            'headers': 'X-Header:123',
            'params': 'A:b',
            'body': {
                'type': 'json',
                'data': '{"a": "{{args1}}"}'
            },
        }
    }, **BASIC_NODE_DATA)

    result = node.run(pool)
    data = result.process_data.get('request', '')

    assert '{"a": "1"}' in data
    assert 'api-key: Basic ak-xxx' in data
    assert 'X-Header: 123' in data

def test_x_www_form_urlencoded(setup_http_mock):
    node = HttpRequestNode(config={
        'id': '1',
        'data': {
            'title': 'http',
            'desc': '',
            'variables': [{
                'variable': 'args1',
                'value_selector': ['1', '123', 'args1'],
            }, {
                'variable': 'args2',
                'value_selector': ['1', '123', 'args2'],
            }],
            'method': 'post',
            'url': 'http://example.com',
            'authorization': {
                'type': 'api-key',
                'config': {
                    'type': 'basic',
                    'api_key':'ak-xxx',
                    'header': 'api-key',
                }
            },
            'headers': 'X-Header:123',
            'params': 'A:b',
            'body': {
                'type': 'x-www-form-urlencoded',
                'data': 'a:{{args1}}\nb:{{args2}}'
            },
        }
    }, **BASIC_NODE_DATA)

    result = node.run(pool)
    data = result.process_data.get('request', '')

    assert 'a=1&b=2' in data
    assert 'api-key: Basic ak-xxx' in data
    assert 'X-Header: 123' in data

def test_form_data(setup_http_mock):
    node = HttpRequestNode(config={
        'id': '1',
        'data': {
            'title': 'http',
            'desc': '',
            'variables': [{
                'variable': 'args1',
                'value_selector': ['1', '123', 'args1'],
            }, {
                'variable': 'args2',
                'value_selector': ['1', '123', 'args2'],
            }],
            'method': 'post',
            'url': 'http://example.com',
            'authorization': {
                'type': 'api-key',
                'config': {
                    'type': 'basic',
                    'api_key':'ak-xxx',
                    'header': 'api-key',
                }
            },
            'headers': 'X-Header:123',
            'params': 'A:b',
            'body': {
                'type': 'form-data',
                'data': 'a:{{args1}}\nb:{{args2}}'
            },
        }
    }, **BASIC_NODE_DATA)

    result = node.run(pool)
    data = result.process_data.get('request', '')

    assert 'form-data; name="a"' in data
    assert '1' in data
    assert 'form-data; name="b"' in data
    assert '2' in data
    assert 'api-key: Basic ak-xxx' in data
    assert 'X-Header: 123' in data

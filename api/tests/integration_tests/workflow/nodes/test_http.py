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
pool.append_variable(node_id='a', variable_key_list=['b123', 'args1'], value=1)
pool.append_variable(node_id='a', variable_key_list=['b123', 'args2'], value=2)

@pytest.mark.parametrize('setup_http_mock', [['none']], indirect=True)
def test_get(setup_http_mock):
    node = HttpRequestNode(config={
        'id': '1',
        'data': {
            'title': 'http',
            'desc': '',
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
def test_custom_authorization_header(setup_http_mock):
    node = HttpRequestNode(config={
        'id': '1',
        'data': {
            'title': 'http',
            'desc': '',
            'method': 'get',
            'url': 'http://example.com',
            'authorization': {
                'type': 'api-key',
                'config': {
                    'type': 'custom',
                    'api_key': 'Auth',
                    'header': 'X-Auth',
                },
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
    assert 'X-Auth: Auth' in data

@pytest.mark.parametrize('setup_http_mock', [['none']], indirect=True)
def test_template(setup_http_mock):
    node = HttpRequestNode(config={
        'id': '1',
        'data': {
            'title': 'http',
            'desc': '',
            'method': 'get',
            'url': 'http://example.com/{{#a.b123.args2#}}',
            'authorization': {
                'type': 'api-key',
                'config': {
                    'type': 'basic',
                    'api_key':'ak-xxx',
                    'header': 'api-key',
                }
            },
            'headers': 'X-Header:123\nX-Header2:{{#a.b123.args2#}}',
            'params': 'A:b\nTemplate:{{#a.b123.args2#}}',
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
                'data': '{"a": "{{#a.b123.args1#}}"}'
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
                'data': 'a:{{#a.b123.args1#}}\nb:{{#a.b123.args2#}}'
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
                'data': 'a:{{#a.b123.args1#}}\nb:{{#a.b123.args2#}}'
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

def test_none_data(setup_http_mock):
    node = HttpRequestNode(config={
        'id': '1',
        'data': {
            'title': 'http',
            'desc': '',
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
                'type': 'none',
                'data': '123123123'
            },
        }
    }, **BASIC_NODE_DATA)

    result = node.run(pool)
    data = result.process_data.get('request', '')

    assert 'api-key: Basic ak-xxx' in data
    assert 'X-Header: 123' in data
    assert '123123123' not in data

import base64

from core.helper.code_executor.code_executor import CodeExecutor
from core.helper.code_executor.jinja2_transformer import JINJA2_PRELOAD, PYTHON_RUNNER

CODE_LANGUAGE = 'jinja2'


def test_jinja2():
    template = 'Hello {{template}}'
    inputs = base64.b64encode(b'{"template": "World"}').decode('utf-8')
    code = PYTHON_RUNNER.replace('{{code}}', template).replace('{{inputs}}', inputs)
    result = CodeExecutor.execute_code(language=CODE_LANGUAGE, preload=JINJA2_PRELOAD, code=code)
    assert result == '<<RESULT>>Hello World<<RESULT>>\n'

import base64

from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage
from core.helper.code_executor.jinja2_transformer import JINJA2_PRELOAD, PYTHON_RUNNER

CODE_LANGUAGE = CodeLanguage.JINJA2


def test_jinja2():
    template = 'Hello {{template}}'
    inputs = base64.b64encode(b'{"template": "World"}').decode('utf-8')
    code = PYTHON_RUNNER.replace('{{code}}', template).replace('{{inputs}}', inputs)
    result = CodeExecutor.execute_code(language=CODE_LANGUAGE, preload=JINJA2_PRELOAD, code=code)
    assert result == '<<RESULT>>Hello World<<RESULT>>\n'


def test_jinja2_with_code_template():
    result = CodeExecutor.execute_workflow_code_template(
        language=CODE_LANGUAGE, code='Hello {{template}}', inputs={'template': 'World'})
    assert result == {'result': 'Hello World'}

from textwrap import dedent

from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage
from core.workflow.nodes.code.code_node import JAVASCRIPT_DEFAULT_CODE

CODE_LANGUAGE = CodeLanguage.JAVASCRIPT


def test_javascript_plain():
    code = 'console.log("Hello World")'
    result_message = CodeExecutor.execute_code(language=CODE_LANGUAGE, preload='', code=code)
    assert result_message == 'Hello World\n'


def test_javascript_json():
    code = dedent("""
    obj = {'Hello': 'World'}
    console.log(JSON.stringify(obj))
    """)
    result = CodeExecutor.execute_code(language=CODE_LANGUAGE, preload='', code=code)
    assert result == '{"Hello":"World"}\n'


def test_javascript_with_code_template():
    result = CodeExecutor.execute_workflow_code_template(
        language=CODE_LANGUAGE, code=JAVASCRIPT_DEFAULT_CODE, inputs={'arg1': 'Hello', 'arg2': 'World'})
    assert result == {'result': 'HelloWorld'}

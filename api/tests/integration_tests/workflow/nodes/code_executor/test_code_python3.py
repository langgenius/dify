from textwrap import dedent

from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage
from core.workflow.nodes.code.code_node import PYTHON_DEFAULT_CODE

CODE_LANGUAGE = CodeLanguage.PYTHON3


def test_python3_plain():
    code = 'print("Hello World")'
    result = CodeExecutor.execute_code(language=CODE_LANGUAGE, preload='', code=code)
    assert result == 'Hello World\n'


def test_python3_json():
    code = dedent("""
    import json
    print(json.dumps({'Hello': 'World'}))
    """)
    result = CodeExecutor.execute_code(language=CODE_LANGUAGE, preload='', code=code)
    assert result == '{"Hello": "World"}\n'


def test_python3_with_code_template():
    result = CodeExecutor.execute_workflow_code_template(
        language=CODE_LANGUAGE, code=PYTHON_DEFAULT_CODE, inputs={'arg1': 'Hello', 'arg2': 'World'})
    assert result == {'result': 'HelloWorld'}

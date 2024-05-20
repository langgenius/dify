import json
from textwrap import dedent

from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage
from core.helper.code_executor.python3.python3_code_provider import Python3CodeProvider

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
        language=CODE_LANGUAGE, code=Python3CodeProvider.get_default_code(), inputs={'arg1': 'Hello', 'arg2': 'World'})
    assert result == {'result': 'HelloWorld'}


def test_python3_list_default_available_packages():
    packages = Python3CodeProvider.get_default_available_packages()
    assert len(packages) > 0
    assert {'requests', 'httpx'}.issubset(p['name'] for p in packages)

    # check JSON serializable
    assert len(str(json.dumps(packages))) > 0

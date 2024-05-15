from textwrap import dedent

from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage
from core.helper.code_executor.javascript.javascript_code_provider import JavascriptCodeProvider

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
        language=CODE_LANGUAGE, code=JavascriptCodeProvider.get_default_code(), inputs={'arg1': 'Hello', 'arg2': 'World'})
    assert result == {'result': 'HelloWorld'}


def test_javascript_list_default_available_packages():
    packages = JavascriptCodeProvider.get_default_available_packages()

    # no default packages available for javascript
    assert len(packages) == 0

import json
from textwrap import dedent

from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage
from core.helper.code_executor.python3.python3_code_provider import Python3CodeProvider
from core.helper.code_executor.python3.python3_transformer import Python3TemplateTransformer

CODE_LANGUAGE = CodeLanguage.PYTHON3


def test_python3_plain():
    code = 'print("Hello World")'
    result = CodeExecutor.execute_code(language=CODE_LANGUAGE, preload="", code=code)
    assert result == "Hello World\n"


def test_python3_json():
    code = dedent("""
    import json
    print(json.dumps({'Hello': 'World'}))
    """)
    result = CodeExecutor.execute_code(language=CODE_LANGUAGE, preload="", code=code)
    assert result == '{"Hello": "World"}\n'


def test_python3_with_code_template():
    result = CodeExecutor.execute_workflow_code_template(
        language=CODE_LANGUAGE, code=Python3CodeProvider.get_default_code(), inputs={"arg1": "Hello", "arg2": "World"}
    )
    assert result == {"result": "HelloWorld"}


def test_python3_get_runner_script():
    runner_script = Python3TemplateTransformer.get_runner_script()
    assert runner_script.count(Python3TemplateTransformer._code_placeholder) == 1
    assert runner_script.count(Python3TemplateTransformer._inputs_placeholder) == 1
    assert runner_script.count(Python3TemplateTransformer._result_tag) == 2

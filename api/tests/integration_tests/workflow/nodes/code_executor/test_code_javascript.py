from textwrap import dedent

from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage
from core.helper.code_executor.javascript.javascript_code_provider import (
    JavascriptCodeProvider,
)
from core.helper.code_executor.javascript.javascript_transformer import (
    NodeJsTemplateTransformer,
)

CODE_LANGUAGE = CodeLanguage.JAVASCRIPT


def test_javascript_plain():
    code = 'console.log("Hello World")'
    result_message = CodeExecutor.execute_code(language=CODE_LANGUAGE, preload="", code=code)
    assert result_message == "Hello World\n"


def test_javascript_json():
    code = dedent("""
    obj = {'Hello': 'World'}
    console.log(JSON.stringify(obj))
    """)
    result = CodeExecutor.execute_code(language=CODE_LANGUAGE, preload="", code=code)
    assert result == '{"Hello":"World"}\n'


def test_javascript_with_code_template():
    result = CodeExecutor.execute_workflow_code_template(
        language=CODE_LANGUAGE,
        code=JavascriptCodeProvider.get_default_code(),
        inputs={"arg1": "Hello", "arg2": "World"},
    )
    assert result == {"result": "HelloWorld"}


def test_javascript_get_runner_script():
    runner_script = NodeJsTemplateTransformer.get_runner_script()
    assert runner_script.count(NodeJsTemplateTransformer._code_placeholder) == 1
    assert runner_script.count(NodeJsTemplateTransformer._inputs_placeholder) == 1
    assert runner_script.count(NodeJsTemplateTransformer._result_tag) == 2

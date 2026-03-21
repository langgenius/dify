from core.helper.code_executor.javascript.javascript_code_provider import JavascriptCodeProvider
from core.helper.code_executor.javascript.javascript_transformer import NodeJsTemplateTransformer


def test_get_runner_script():
    code = JavascriptCodeProvider.get_default_code()
    inputs = {"arg1": "hello, ", "arg2": "world!"}
    script = NodeJsTemplateTransformer.assemble_runner_script(code, inputs)
    script_lines = script.splitlines()
    code_lines = code.splitlines()
    # Check that the first lines of script are exactly the same as code
    assert script_lines[: len(code_lines)] == code_lines

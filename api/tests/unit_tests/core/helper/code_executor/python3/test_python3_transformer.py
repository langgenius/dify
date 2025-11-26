from core.helper.code_executor.python3.python3_code_provider import Python3CodeProvider
from core.helper.code_executor.python3.python3_transformer import Python3TemplateTransformer


def test_get_runner_script():
    code = Python3CodeProvider.get_default_code()
    inputs = {"arg1": "hello, ", "arg2": "world!"}
    script = Python3TemplateTransformer.assemble_runner_script(code, inputs)
    script_lines = script.splitlines()
    code_lines = code.splitlines()
    # Check that the first lines of script are exactly the same as code
    assert script_lines[: len(code_lines)] == code_lines

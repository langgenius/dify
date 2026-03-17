from core.helper.code_executor.python3.python3_code_provider import Python3CodeProvider
from core.helper.code_executor.python3.python3_transformer import Python3TemplateTransformer


def test_get_runner_script():
    code = Python3CodeProvider.get_default_code()
    inputs = {"arg1": "hello, ", "arg2": "world!"}
    script = Python3TemplateTransformer.assemble_runner_script(code, inputs)
    script_lines = script.splitlines()
    code_lines = code.splitlines()
    # First line is a random anti-KPA padding comment
    assert script_lines[0].startswith("# ")
    # User code follows immediately after the padding line
    assert script_lines[1 : 1 + len(code_lines)] == code_lines


def test_anti_kpa_padding_is_unique():
    code = Python3CodeProvider.get_default_code()
    inputs = {"arg1": "a", "arg2": "b"}
    script_a = Python3TemplateTransformer.assemble_runner_script(code, inputs)
    script_b = Python3TemplateTransformer.assemble_runner_script(code, inputs)
    padding_a = script_a.splitlines()[0]
    padding_b = script_b.splitlines()[0]
    assert padding_a != padding_b, "Each assembled script must have unique random padding"

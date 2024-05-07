from core.helper.code_executor.code_executor import CodeExecutor

CODE_LANGUAGE = 'python3'


def test_python3_plain():
    code = 'print("Hello World")'
    result = CodeExecutor.execute_code(language=CODE_LANGUAGE, preload='', code=code)
    assert result == 'Hello World\n'


def test_python3_json():
    code = """
import json
print(json.dumps({'Hello': 'World'}))
    """
    result = CodeExecutor.execute_code(language=CODE_LANGUAGE, preload='', code=code)
    assert result == '{"Hello": "World"}\n'

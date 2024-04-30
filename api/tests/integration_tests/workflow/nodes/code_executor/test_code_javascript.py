from core.helper.code_executor.code_executor import CodeExecutor

CODE_LANGUAGE = 'javascript'


def test_javascript_plain():
    code = 'console.log("Hello World")'
    result_message = CodeExecutor.execute_code(language=CODE_LANGUAGE, preload='', code=code)
    assert result_message == 'Hello World\n'


def test_javascript_json():
    code = """
obj = {'Hello': 'World'}
console.log(JSON.stringify(obj))
    """
    result = CodeExecutor.execute_code(language=CODE_LANGUAGE, preload='', code=code)
    assert result == '{"Hello":"World"}\n'

from pytest_mock import MockerFixture

from core.helper.code_executor.jinja2.jinja2_formatter import Jinja2Formatter


def test_format_returns_result_value_as_string(mocker: MockerFixture) -> None:
    execute_mock = mocker.patch(
        "core.helper.code_executor.jinja2.jinja2_formatter.CodeExecutor.execute_workflow_code_template",
        return_value={"result": 123},
    )

    formatted = Jinja2Formatter.format("Hello {{ name }}", {"name": "Dify"})

    assert formatted == "123"
    execute_mock.assert_called_once()


def test_format_returns_empty_string_when_result_missing(mocker: MockerFixture) -> None:
    mocker.patch(
        "core.helper.code_executor.jinja2.jinja2_formatter.CodeExecutor.execute_workflow_code_template",
        return_value={},
    )

    assert Jinja2Formatter.format("Hello", {"name": "Dify"}) == ""

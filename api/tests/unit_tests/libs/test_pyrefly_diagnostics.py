from libs.pyrefly_diagnostics import extract_diagnostics


def test_extract_diagnostics_keeps_only_summary_and_location_lines() -> None:
    # Arrange
    raw_output = """INFO Checking project configured at `/tmp/project/pyrefly.toml`
ERROR `result` may be uninitialized [unbound-name]
   --> controllers/console/app/annotation.py:126:16
    |
126 |         return result, 200
    |                ^^^^^^
    |
ERROR Object of class `App` has no attribute `access_mode` [missing-attribute]
   --> controllers/console/app/app.py:574:13
    |
574 |             app_model.access_mode = app_setting.access_mode
    |             ^^^^^^^^^^^^^^^^^^^^^
"""

    # Act
    diagnostics = extract_diagnostics(raw_output)

    # Assert
    assert diagnostics == (
        "ERROR `result` may be uninitialized [unbound-name]\n"
        "   --> controllers/console/app/annotation.py:126:16\n"
        "ERROR Object of class `App` has no attribute `access_mode` [missing-attribute]\n"
        "   --> controllers/console/app/app.py:574:13\n"
    )


def test_extract_diagnostics_handles_error_without_location_line() -> None:
    # Arrange
    raw_output = "ERROR unexpected pyrefly output format [bad-format]\n"

    # Act
    diagnostics = extract_diagnostics(raw_output)

    # Assert
    assert diagnostics == "ERROR unexpected pyrefly output format [bad-format]\n"


def test_extract_diagnostics_returns_empty_for_non_error_output() -> None:
    # Arrange
    raw_output = "INFO Checking project configured at `/tmp/project/pyrefly.toml`\n"

    # Act
    diagnostics = extract_diagnostics(raw_output)

    # Assert
    assert diagnostics == ""

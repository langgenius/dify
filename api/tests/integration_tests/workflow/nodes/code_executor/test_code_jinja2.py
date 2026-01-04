import base64

from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage
from core.helper.code_executor.jinja2.jinja2_transformer import Jinja2TemplateTransformer

CODE_LANGUAGE = CodeLanguage.JINJA2


def test_jinja2():
    """Test basic Jinja2 template rendering."""
    template = "Hello {{template}}"
    # Template must be base64 encoded to match the new safe embedding approach
    template_b64 = base64.b64encode(template.encode("utf-8")).decode("utf-8")
    inputs = base64.b64encode(b'{"template": "World"}').decode("utf-8")
    code = (
        Jinja2TemplateTransformer.get_runner_script()
        .replace(Jinja2TemplateTransformer._template_b64_placeholder, template_b64)
        .replace(Jinja2TemplateTransformer._inputs_placeholder, inputs)
    )
    result = CodeExecutor.execute_code(
        language=CODE_LANGUAGE, preload=Jinja2TemplateTransformer.get_preload_script(), code=code
    )
    assert result == "<<RESULT>>Hello World<<RESULT>>\n"


def test_jinja2_with_code_template():
    """Test template rendering via the high-level workflow API."""
    result = CodeExecutor.execute_workflow_code_template(
        language=CODE_LANGUAGE, code="Hello {{template}}", inputs={"template": "World"}
    )
    assert result == {"result": "Hello World"}


def test_jinja2_get_runner_script():
    """Test that runner script contains required placeholders."""
    runner_script = Jinja2TemplateTransformer.get_runner_script()
    assert runner_script.count(Jinja2TemplateTransformer._template_b64_placeholder) == 1
    assert runner_script.count(Jinja2TemplateTransformer._inputs_placeholder) == 1
    assert runner_script.count(Jinja2TemplateTransformer._result_tag) == 2


def test_jinja2_template_with_special_characters():
    """
    Test that templates with special characters (quotes, newlines) render correctly.
    This is a regression test for issue #26818 where textarea pre-fill values
    containing special characters would break template rendering.
    """
    # Template with triple quotes, single quotes, double quotes, and newlines
    template = """<html>
<body>
    <input value="{{ task.get('Task ID', '') }}"/>
    <textarea>{{ task.get('Issues', 'No issues reported') }}</textarea>
    <p>Status: "{{ status }}"</p>
    <pre>'''code block'''</pre>
</body>
</html>"""
    inputs = {"task": {"Task ID": "TASK-123", "Issues": "Line 1\nLine 2\nLine 3"}, "status": "completed"}

    result = CodeExecutor.execute_workflow_code_template(language=CODE_LANGUAGE, code=template, inputs=inputs)

    # Verify the template rendered correctly with all special characters
    output = result["result"]
    assert 'value="TASK-123"' in output
    assert "<textarea>Line 1\nLine 2\nLine 3</textarea>" in output
    assert 'Status: "completed"' in output
    assert "'''code block'''" in output


def test_jinja2_template_with_html_textarea_prefill():
    """
    Specific test for HTML textarea with Jinja2 variable pre-fill.
    Verifies fix for issue #26818.
    """
    template = "<textarea name='notes'>{{ notes }}</textarea>"
    notes_content = "This is a multi-line note.\nWith special chars: 'single' and \"double\" quotes."
    inputs = {"notes": notes_content}

    result = CodeExecutor.execute_workflow_code_template(language=CODE_LANGUAGE, code=template, inputs=inputs)

    expected_output = f"<textarea name='notes'>{notes_content}</textarea>"
    assert result["result"] == expected_output


def test_jinja2_assemble_runner_script_encodes_template():
    """Test that assemble_runner_script properly base64 encodes the template."""
    template = "Hello {{ name }}!"
    inputs = {"name": "World"}

    script = Jinja2TemplateTransformer.assemble_runner_script(template, inputs)

    # The template should be base64 encoded in the script
    template_b64 = base64.b64encode(template.encode("utf-8")).decode("utf-8")
    assert template_b64 in script
    # The raw template should NOT appear in the script (it's encoded)
    assert "Hello {{ name }}!" not in script

import json
from unittest.mock import MagicMock, patch

from core.llm_generator.llm_generator import LLMGenerator


class DummyMessage:
    def __init__(self, content):
        self.content = content


class DummyResponse:
    def __init__(self, content):
        self.message = DummyMessage(content)


def make_json_response(language, output):
    return json.dumps({"Language Type": language, "Your Reasoning": "...", "Your Output": output})


@patch("core.llm_generator.llm_generator.ModelManager.get_default_model_instance")
def test_generate_conversation_name_enforces_persian(mock_get_model):
    # A Persian input containing Persian-specific character 'پ'
    persian_query = "سلام، چطوری؟ پ"  # contains 'پ'

    # First model response: misdetected as Arabic and returns Arabic title
    first_resp = DummyResponse(make_json_response("Arabic", "مرحبا"))
    # Second response (after retry): returns a Persian title with Persian-specific chars
    second_resp = DummyResponse(make_json_response("Persian", "عنوان پِرس"))

    model_instance = MagicMock()
    model_instance.invoke_llm.side_effect = [first_resp, second_resp]

    mock_get_model.return_value = model_instance

    name = LLMGenerator.generate_conversation_name("tenant1", persian_query)

    # The final name should come from the Persian response (contains Persian-specific char 'پ')
    assert "پ" in name
    # Ensure the model was invoked at least twice (retry occurred)
    assert model_instance.invoke_llm.call_count >= 2


@patch("core.llm_generator.llm_generator.ModelManager.get_default_model_instance")
def test_generate_conversation_name_translation_fallback(mock_get_model):
    # Persian query
    persian_query = "این یک تست است پ"

    # Model returns non-Persian outputs consistently
    non_persian_resp = DummyResponse(make_json_response("Arabic", "مرحبا"))

    # Translate response (last call) returns Persian translation
    translate_resp = DummyResponse("عنوان ترجمه شده پ")

    model_instance = MagicMock()
    # First two calls return non-persian results; third call is translation
    model_instance.invoke_llm.side_effect = [non_persian_resp, non_persian_resp, translate_resp]

    mock_get_model.return_value = model_instance

    name = LLMGenerator.generate_conversation_name("tenant1", persian_query)

    # Final name should contain Persian character 'پ' from translation fallback
    assert "پ" in name
    assert model_instance.invoke_llm.call_count >= 3


@patch("core.llm_generator.llm_generator.ModelManager.get_default_model_instance")
def test_generate_conversation_name_enforces_persian_retry_prompt(mock_get_model):
    # A Persian input containing Persian-specific character 'پ'
    persian_query = "سلام، چطوری؟ پ"

    # First model response: misdetected as Arabic and returns Arabic title
    first_resp = DummyResponse(make_json_response("Arabic", "مرحبا"))
    # Second response (after retry): returns a Persian title with Persian-specific chars
    second_resp = DummyResponse(make_json_response("Persian", "عنوان پِرس"))

    model_instance = MagicMock()
    model_instance.invoke_llm.side_effect = [first_resp, second_resp]

    mock_get_model.return_value = model_instance

    name = LLMGenerator.generate_conversation_name("tenant1", persian_query)

    # The final name should come from the Persian response (contains Persian-specific char 'پ')
    assert "پ" in name

    # Ensure the retry prompt included a stronger Persian-only instruction
    assert model_instance.invoke_llm.call_count >= 2
    second_call_kwargs = model_instance.invoke_llm.call_args_list[1][1]
    prompt_msg = second_call_kwargs["prompt_messages"][0]
    assert "CRITICAL: You must output the title in Persian" in prompt_msg.content


@patch("core.llm_generator.llm_generator.ModelManager.get_default_model_instance")
def test_generate_conversation_name_handles_invoke_error(mock_get_model):
    # If LLM invocation raises InvokeError, ensure fallback/translation is attempted and no exception bubbles
    from core.model_runtime.errors.invoke import InvokeError

    persian_query = "سلام، پ"

    model_instance = MagicMock()
    # First invocation raises InvokeError; translation attempt returns Persian translation
    model_instance.invoke_llm.side_effect = [InvokeError("boom"), DummyResponse("عنوان ترجمه شده پ")]

    mock_get_model.return_value = model_instance

    name = LLMGenerator.generate_conversation_name("tenant1", persian_query)

    assert "پ" in name

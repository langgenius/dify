import json
import os
from collections.abc import Generator

from core.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from core.model_runtime.model_providers.tongyi.llm.llm import TongyiLargeLanguageModel


def test_invoke_model_with_json_response():
    """
    Test the invocation of a model with JSON response.
    """
    model_list = [
        "qwen-max-0403",
        "qwen-max-1201",
        "qwen-max-longcontext",
        "qwen-max",
        "qwen-plus-chat",
        "qwen-plus",
        "qwen-turbo-chat",
        "qwen-turbo",
    ]
    for model_name in model_list:
        print("testing model: ", model_name)
        invoke_model_with_json_response(model_name)


def invoke_model_with_json_response(model_name="qwen-max-0403"):
    """
    Method to invoke the model with JSON response format.
    Args:
        model_name (str): The name of the model to invoke. Defaults to "qwen-max-0403".

    Returns:
        None
    """
    model = TongyiLargeLanguageModel()

    response = model.invoke(
        model=model_name,
        credentials={
            'dashscope_api_key': os.environ.get('TONGYI_DASHSCOPE_API_KEY')
        },
        prompt_messages=[
            UserPromptMessage(
                content='output json data with format `{"data": "test", "code": 200, "msg": "success"}'
            )
        ],
        model_parameters={
            'temperature': 0.5,
            'max_tokens': 50,
            'response_format': 'JSON',
        },
        stream=True,
        user="abc-123"
    )
    print("=====================================")
    print(response)
    assert isinstance(response, Generator)
    output = ""
    for chunk in response:
        assert isinstance(chunk, LLMResultChunk)
        assert isinstance(chunk.delta, LLMResultChunkDelta)
        assert isinstance(chunk.delta.message, AssistantPromptMessage)
        output += chunk.delta.message.content
    assert is_json(output)


def is_json(s):
    """
    Check if a string is a valid JSON.

    Args:
        s (str): The string to check.

    Returns:
        bool: True if the string is a valid JSON, False otherwise.
    """
    try:
        json.loads(s)
    except ValueError:
        return False
    return True
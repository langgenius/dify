import os

from core.model_runtime.model_providers.gitee_ai.tts.tts import GiteeAIText2SpeechModel


def test_invoke_model():
    model = GiteeAIText2SpeechModel()

    result = model.invoke(
        model="speecht5_tts",
        tenant_id="test",
        credentials={
            "api_key": os.environ.get("GITEE_AI_API_KEY"),
        },
        content_text="Hello, world!",
        voice="",
    )

    content = b""
    for chunk in result:
        content += chunk

    assert content != b""

import os

from core.model_runtime.model_providers.gpustack.tts.tts import GPUStackText2SpeechModel


def test_invoke_model():
    model = GPUStackText2SpeechModel()

    result = model.invoke(
        model="cosyvoice-300m-sft",
        tenant_id="test",
        credentials={
            "endpoint_url": os.environ.get("GPUSTACK_SERVER_URL"),
            "api_key": os.environ.get("GPUSTACK_API_KEY"),
        },
        content_text="Hello world",
        voice="Chinese Female",
    )

    content = b""
    for chunk in result:
        content += chunk

    assert content != b""

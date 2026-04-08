from pydantic import BaseModel


class TextToAudioPayload(BaseModel):
    message_id: str | None = None
    voice: str | None = None
    text: str | None = None
    streaming: bool | None = None

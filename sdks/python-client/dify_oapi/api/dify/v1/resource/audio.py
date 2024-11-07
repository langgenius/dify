from dify_oapi.core.const import CONTENT_TYPE, APPLICATION_JSON
from dify_oapi.core.http.transport import ATransport, Transport
from dify_oapi.core.model.config import Config
from dify_oapi.core.model.request_option import RequestOption

from ..model.text_to_audio_request import TextToAudioRequest
from ..model.text_to_audio_response import TextToAudioResponse


class Audio:
    def __init__(self, config: Config) -> None:
        self.config: Config = config

    def from_text(
        self, request: TextToAudioRequest, option: RequestOption | None = None
    ) -> TextToAudioResponse:
        if request.body is not None:
            option.headers[CONTENT_TYPE] = f"{APPLICATION_JSON}; charset=utf-8"
        return Transport.execute(
            self.config, request, unmarshal_as=TextToAudioResponse, option=option
        )

    async def afrom_text(
        self, request: TextToAudioRequest, option: RequestOption | None = None
    ) -> TextToAudioResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=TextToAudioResponse, option=option
        )

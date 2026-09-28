import base64
import logging
import queue
import re
import threading

from core.app.entities.queue_entities import (
    MessageQueueMessage,
    QueueAgentMessageEvent,
    QueueLLMChunkEvent,
    QueueNodeSucceededEvent,
    QueueTextChunkEvent,
    WorkflowQueueMessage,
)
from core.base.tts.audio_mime import (
    DEFAULT_TTS_AUDIO_MIME_TYPE,
    get_model_audio_mime_type,
    inspect_audio_stream,
)
from core.credit_usage import CreditUsageAppType, CreditUsageCreatedBy
from core.model_manager import ModelManager
from graphon.model_runtime.entities.message_entities import TextPromptMessageContent
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeBadRequestError


class AudioTrunk:
    def __init__(self, status: str, audio, audio_type: str | None = None, error: Exception | None = None):
        self.audio = audio
        self.status = status
        self.audio_type = audio_type
        self.error = error


class AppGeneratorTTSPublisher:
    def __init__(
        self,
        tenant_id: str,
        voice: str,
        language: str | None = None,
        app_type: CreditUsageAppType = CreditUsageAppType.UNKNOWN,
        created_by: CreditUsageCreatedBy = CreditUsageCreatedBy.AUDIO,
    ):
        self.logger = logging.getLogger(__name__)
        self.tenant_id = tenant_id
        self.msg_text = ""
        self._audio_queue: queue.Queue[AudioTrunk] = queue.Queue()
        self._msg_queue: queue.Queue[WorkflowQueueMessage | MessageQueueMessage | None] = queue.Queue()
        self.match = re.compile(r"[。.!?]")
        self.model_manager = ModelManager.for_tenant(
            tenant_id=self.tenant_id,
            user_id="responding_tts",
            request_metadata={"app_type": app_type, "created_by": created_by},
        )
        self.model_instance = self.model_manager.get_default_model_instance(
            tenant_id=self.tenant_id, model_type=ModelType.TTS
        )
        self._declared_audio_mime_type = get_model_audio_mime_type(self.model_instance)
        self.voices = self.model_instance.get_tts_voices(language=language)
        values = [voice.get("value") for voice in self.voices]
        self.voice = voice
        if not voice or voice not in values:
            self.voice = self.voices[0].get("value")
        self.max_sentence = 2
        self._last_audio_event: AudioTrunk | None = None
        self._cancelled = threading.Event()
        threading.Thread(target=self._runtime, daemon=True).start()

    def publish(self, message: WorkflowQueueMessage | MessageQueueMessage | None, /):
        self._msg_queue.put(message)

    def cancel(self):
        if self._cancelled.is_set():
            return
        self._cancelled.set()
        self._msg_queue.put(None)

    def _runtime(self):
        audio_type = self._declared_audio_mime_type or DEFAULT_TTS_AUDIO_MIME_TYPE
        resolved_audio_type: str | None = None
        try:
            while True:
                message = self._msg_queue.get()
                if self._cancelled.is_set():
                    return
                text_content = ""
                incremental_request = False
                if message is None:
                    text_content = self.msg_text
                else:
                    match message.event:
                        case QueueAgentMessageEvent() | QueueLLMChunkEvent():
                            message_content = message.event.chunk.delta.message.content
                            if not message_content:
                                continue
                            match message_content:
                                case str():
                                    self.msg_text += message_content
                                case list():
                                    for content in message_content:
                                        if not isinstance(content, TextPromptMessageContent):
                                            continue
                                        self.msg_text += content.data
                        case QueueTextChunkEvent():
                            self.msg_text += message.event.text
                        case QueueNodeSucceededEvent():
                            if message.event.outputs is None:
                                continue
                            output = message.event.outputs.get("output", "")
                            if isinstance(output, str):
                                self.msg_text += output
                    sentence_arr, text_tmp = self._extract_sentence(self.msg_text)
                    if self._declared_audio_mime_type == DEFAULT_TTS_AUDIO_MIME_TYPE and len(sentence_arr) >= min(
                        self.max_sentence, 7
                    ):
                        self.max_sentence += 1
                        text_content = "".join(sentence_arr)
                        self.msg_text = text_tmp
                        incremental_request = True

                if text_content and not text_content.isspace():
                    invoke_result = self.model_instance.invoke_tts(content_text=text_content.strip(), voice=self.voice)
                    audio_stream, next_audio_type = inspect_audio_stream(invoke_result, self._declared_audio_mime_type)
                    if self._cancelled.is_set():
                        return
                    if incremental_request and next_audio_type != DEFAULT_TTS_AUDIO_MIME_TYPE:
                        raise InvokeBadRequestError(
                            "The TTS model declared MP3 but returned a format that cannot be played incrementally"
                        )
                    if resolved_audio_type and resolved_audio_type != next_audio_type:
                        raise InvokeBadRequestError(
                            "TTS provider changed MIME type between audio responses: "
                            f"{resolved_audio_type} then {next_audio_type}"
                        )
                    resolved_audio_type = audio_type = next_audio_type
                    for audio in audio_stream:
                        # ponytail: reads stop at the next chunk; add transport cancellation when Graphon exposes it.
                        if self._cancelled.is_set():
                            return
                        self._audio_queue.put(
                            AudioTrunk(
                                "responding",
                                audio=base64.b64encode(audio),
                                audio_type=audio_type,
                            )
                        )

                if message is None:
                    break
        except Exception as e:
            self.logger.warning("TTS generation failed", exc_info=True)
            self._audio_queue.put(AudioTrunk("error", b"", audio_type=audio_type, error=e))
            return

        self._audio_queue.put(AudioTrunk("finish", b"", audio_type=audio_type))

    def check_and_get_audio(self, *, block: bool = False):
        try:
            if self._last_audio_event and self._last_audio_event.status in {"finish", "error"}:
                return self._last_audio_event
            audio = self._audio_queue.get(block=block)
            self._last_audio_event = audio
            return audio
        except queue.Empty:
            return None

    def _extract_sentence(self, org_text):
        tx = self.match.finditer(org_text)
        start = 0
        result = []
        for i in tx:
            end = i.regs[0][1]
            result.append(org_text[start:end])
            start = end
        return result, org_text[start:]

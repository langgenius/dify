import base64
import concurrent.futures
import logging
import queue
import re
import threading
from collections.abc import Iterable

from core.app.entities.queue_entities import (
    MessageQueueMessage,
    QueueAgentMessageEvent,
    QueueLLMChunkEvent,
    QueueNodeSucceededEvent,
    QueueTextChunkEvent,
    WorkflowQueueMessage,
)
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.message_entities import TextPromptMessageContent
from core.model_runtime.entities.model_entities import ModelType


class AudioTrunk:
    def __init__(self, status: str, audio):
        self.audio = audio
        self.status = status


def _invoice_tts(text_content: str, model_instance: ModelInstance, tenant_id: str, voice: str):
    if not text_content or text_content.isspace():
        return
    return model_instance.invoke_tts(
        content_text=text_content.strip(), user="responding_tts", tenant_id=tenant_id, voice=voice
    )


def _process_future(
    future_queue: queue.Queue[concurrent.futures.Future[Iterable[bytes] | None] | None],
    audio_queue: queue.Queue[AudioTrunk],
):
    while True:
        try:
            future = future_queue.get()
            if future is None:
                break
            invoke_result = future.result()
            if not invoke_result:
                continue
            for audio in invoke_result:
                audio_base64 = base64.b64encode(bytes(audio))
                audio_queue.put(AudioTrunk("responding", audio=audio_base64))
        except Exception as e:
            logging.getLogger(__name__).warning(e)
            break
    audio_queue.put(AudioTrunk("finish", b""))


class AppGeneratorTTSPublisher:
    def __init__(self, tenant_id: str, voice: str, language: str | None = None):
        self.logger = logging.getLogger(__name__)
        self.tenant_id = tenant_id
        self.msg_text = ""
        self._audio_queue: queue.Queue[AudioTrunk] = queue.Queue()
        self._msg_queue: queue.Queue[WorkflowQueueMessage | MessageQueueMessage | None] = queue.Queue()
        self.match = re.compile(r"[。.!?]")
        self.model_manager = ModelManager()
        self.model_instance = self.model_manager.get_default_model_instance(
            tenant_id=self.tenant_id, model_type=ModelType.TTS
        )
        self.voices = self.model_instance.get_tts_voices(language=language)
        values = [voice.get("value") for voice in self.voices]
        self.voice = voice
        if not voice or voice not in values:
            self.voice = self.voices[0].get("value")
        self.max_sentence = 2
        self._last_audio_event: AudioTrunk | None = None
        # FIXME better way to handle this threading.start
        threading.Thread(target=self._runtime).start()
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=3)

    def publish(self, message: WorkflowQueueMessage | MessageQueueMessage | None, /):
        self._msg_queue.put(message)

    def _runtime(self):
        future_queue: queue.Queue[concurrent.futures.Future[Iterable[bytes] | None] | None] = queue.Queue()
        threading.Thread(target=_process_future, args=(future_queue, self._audio_queue)).start()
        while True:
            try:
                message = self._msg_queue.get()
                if message is None:
                    if self.msg_text and len(self.msg_text.strip()) > 0:
                        futures_result = self.executor.submit(
                            _invoice_tts, self.msg_text, self.model_instance, self.tenant_id, self.voice
                        )
                        future_queue.put(futures_result)
                    break
                elif isinstance(message.event, QueueAgentMessageEvent | QueueLLMChunkEvent):
                    message_content = message.event.chunk.delta.message.content
                    if not message_content:
                        continue
                    if isinstance(message_content, str):
                        self.msg_text += message_content
                    elif isinstance(message_content, list):
                        for content in message_content:
                            if not isinstance(content, TextPromptMessageContent):
                                continue
                            self.msg_text += content.data
                elif isinstance(message.event, QueueTextChunkEvent):
                    self.msg_text += message.event.text
                elif isinstance(message.event, QueueNodeSucceededEvent):
                    if message.event.outputs is None:
                        continue
                    output = message.event.outputs.get("output", "")
                    if isinstance(output, str):
                        self.msg_text += output
                self.last_message = message
                sentence_arr, text_tmp = self._extract_sentence(self.msg_text)
                if len(sentence_arr) >= min(self.max_sentence, 7):
                    self.max_sentence += 1
                    text_content = "".join(sentence_arr)
                    futures_result = self.executor.submit(
                        _invoice_tts, text_content, self.model_instance, self.tenant_id, self.voice
                    )
                    future_queue.put(futures_result)
                    if isinstance(text_tmp, str):
                        self.msg_text = text_tmp
                    else:
                        self.msg_text = ""

            except Exception as e:
                self.logger.warning(e)
                break
        future_queue.put(None)

    def check_and_get_audio(self):
        try:
            if self._last_audio_event and self._last_audio_event.status == "finish":
                if self.executor:
                    self.executor.shutdown(wait=False)
                return self._last_audio_event
            audio = self._audio_queue.get_nowait()
            if audio and audio.status == "finish":
                self.executor.shutdown(wait=False)
            if audio:
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

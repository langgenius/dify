from funasr_onnx import Paraformer
from funasr_onnx import CT_Transformer
from funasr_onnx import Fsmn_vad
import numpy as np
import threading
import logging
from core.asr.base import Audio
import soundfile as sf

logger = logging.getLogger(__name__)
lock = threading.Lock()

class ParaformerAsr(Audio):
    __instance = None
    def __new__(cls):
        if cls.__instance is None:
            cls.__instance = object.__new__(cls)
            model_para_dir = "damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"
            model_punc_dir = "damo/punc_ct-transformer_zh-cn-common-vocab272727-pytorch"
            model_vad_dir = "damo/speech_fsmn_vad_zh-cn-16k-common-pytorch"

            cls.model_para = Paraformer(model_para_dir, batch_size=1, quantize=False)
            cls.model_punc = CT_Transformer(model_punc_dir)
            # model_vad_online = Fsmn_vad_online(model_vad_dir)
            cls.model_vad = Fsmn_vad(model_vad_dir)

        return cls.__instance

    def __init__(self):
        pass

    def transcribe(self, audio_in) -> "str":
        """
        transcribe audio_in to text
        :param audio_in: audio_in
        :return: text
        
        """
        if isinstance(audio_in, str):
            if audio_in.startswith("http"):
                import urllib.request
                import tempfile
                # Download the file and save it to a temporary location
                temp_file_path = tempfile.NamedTemporaryFile().name
                urllib.request.urlretrieve(audio_in, temp_file_path)
            else:
                temp_file_path = audio_in
                # Read the sound file from the temporary location
            self.data, self.samplerate = sf.read(temp_file_path)
        elif isinstance(audio_in, bytes):
            import io
            buffer = io.BytesIO(audio_in)
            buffer.name = 'temp.mp3'
            self.data, self.samplerate = sf.read(buffer, dtype='float32')
        else:
            raise Exception("Audio is None")
        try:
            lock.acquire()
            text = self._trans_file(self.data, self.samplerate)
            return text
        finally:
            lock.release()
        return ""

    def _trans_file(self, speech, frame_rate):
        """
        use onnx funasr
        channel : 音频通道
        speekcer ：当前通道的说话人
        """
        logger.debug(f"speach length : {len(speech)}, frame rate : {frame_rate}")
        wav_vad = self.model_vad(speech)
        param_dict_asr = {}
        asr_text =""
        for start, end in wav_vad[0]:
            start_b = int(start * frame_rate / 1000)
            end_b = int(end * frame_rate / 1000)
            asr_result = self.model_para(speech[start_b:end_b],
                                         param_dict=param_dict_asr)
            text = asr_result[0]['preds'][0]
            text_punc = self.model_punc(text) if text else ""
            asr_text += text_punc[0]

        return {"text":asr_text}

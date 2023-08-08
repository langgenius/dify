# rec_result = inference_pipeline(audio_in='https://isv-data.oss-cn-hangzhou.aliyuncs.com/ics/MaaS/ASR/test_audio/asr_example_zh.pcm', audio_fs=16000)

from core.asr.para_asr import ParaformerAsr
import unittest

class TestAsr(unittest.TestCase):
    def setUp(self):
        self.audio_file = 'https://isv-data.oss-cn-hangzhou.aliyuncs.com/ics/MaaS/ASR/test_audio/asr_example_zh.wav'
        self.funasr = ParaformerAsr()

    def test_transcribe(self):
        rec_result = self.funasr.transcribe(self.audio_file)
        self.assertEqual(rec_result, {'text': '欢迎大家来体验达摩院推出的语音识别模型。'})

if __name__ == '__main__':
    unittest.main()
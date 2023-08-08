from abc import abstractmethod

class Audio:

    @abstractmethod
    def transcribe(self, audio_in) -> dict:
        """
        Transcribe audio file to text
        :param file: file path
        :return {
            'text': str,
            'confidence': float
        }
        """

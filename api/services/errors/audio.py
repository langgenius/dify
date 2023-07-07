from services.errors.base import BaseServiceError

class NoAudioUploadedServiceError(BaseServiceError):
    error_code = 'no_audio_uploaded'
    description = "Please upload your audio."
    code = 400


class AudioTooLargeServiceError(BaseServiceError):
    error_code = 'audio_too_large'
    description = "Audio size exceeded. {message}"
    code = 413


class UnsupportedAudioTypeServiceError(BaseServiceError):
    error_code = 'unsupported_audio_type'
    description = "Audio type not allowed."
    code = 415

class ProviderNotSupportSpeechToTextServiceError(BaseServiceError):
    error_code = 'provider_not_support_speech_to_text'
    description = "Provider not support speech to text. {message}"
    code = 400
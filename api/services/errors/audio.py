class NoAudioUploadedServiceError(Exception):
    pass


class AudioTooLargeServiceError(Exception):
    pass


class UnsupportedAudioTypeServiceError(Exception):
    pass


class ProviderNotSupportSpeechToTextServiceError(Exception):
    pass


class SpeechToTextDisabledServiceError(Exception):
    """Raised when the effective app configuration disables speech-to-text."""


class ProviderNotSupportTextToSpeechServiceError(Exception):
    pass


class ProviderNotSupportTextToSpeechLanageServiceError(Exception):
    pass

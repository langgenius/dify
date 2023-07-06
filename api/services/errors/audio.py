from libs.exception import BaseHTTPException

class NoAudioUploadedError(BaseHTTPException):
    error_code = 'no_audio_uploaded'
    description = "Please upload your audio."
    code = 400


class AudioTooLargeError(BaseHTTPException):
    error_code = 'audio_too_large'
    description = "Audio size exceeded. {message}"
    code = 413


class UnsupportedAudioTypeError(BaseHTTPException):
    error_code = 'unsupported_audio_type'
    description = "Audio type not allowed."
    code = 415
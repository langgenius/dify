from controllers.common.errors import (
    BlockedFileExtensionError,
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    RemoteFileUploadError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)


class TestFilenameNotExistsError:
    def test_defaults(self):
        error = FilenameNotExistsError()

        assert error.code == 400
        assert error.description == "The specified filename does not exist."


class TestRemoteFileUploadError:
    def test_defaults(self):
        error = RemoteFileUploadError()

        assert error.code == 400
        assert error.description == "Error uploading remote file."


class TestFileTooLargeError:
    def test_defaults(self):
        error = FileTooLargeError()

        assert error.code == 413
        assert error.error_code == "file_too_large"
        assert error.description == "File size exceeded. {message}"


class TestUnsupportedFileTypeError:
    def test_defaults(self):
        error = UnsupportedFileTypeError()

        assert error.code == 415
        assert error.error_code == "unsupported_file_type"
        assert error.description == "File type not allowed."


class TestBlockedFileExtensionError:
    def test_defaults(self):
        error = BlockedFileExtensionError()

        assert error.code == 400
        assert error.error_code == "file_extension_blocked"
        assert error.description == "The file extension is blocked for security reasons."


class TestTooManyFilesError:
    def test_defaults(self):
        error = TooManyFilesError()

        assert error.code == 400
        assert error.error_code == "too_many_files"
        assert error.description == "Only one file is allowed."


class TestNoFileUploadedError:
    def test_defaults(self):
        error = NoFileUploadedError()

        assert error.code == 400
        assert error.error_code == "no_file_uploaded"
        assert error.description == "Please upload your file."

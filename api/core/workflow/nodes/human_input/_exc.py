from graphon.file.enums import FileTransferMethod


class InvalidConfigError(Exception):
    pass


class InvalidSubmittedDataError(Exception):
    pass


class InvalidTransferMethodError(InvalidConfigError):
    transfer_method: FileTransferMethod

    def __init__(self, transfer_method: FileTransferMethod) -> None:
        self.transfer_method = transfer_method
        super().__init__(f"invalid file transfer method: {transfer_method}")


class ExtensionsNotSetErrorValueError(InvalidConfigError):
    def __init__(self) -> None:
        super().__init__("allowed_file_extensions not set")

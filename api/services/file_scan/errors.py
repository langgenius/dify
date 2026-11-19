from services.file_scan.entities import ScanOutcome


class FileScanError(Exception):
    """Base error of the file scan services."""


class FileScanValidationError(FileScanError, ValueError):
    """Provider or policy input is invalid."""


class FileScanProviderNotFoundError(FileScanError):
    pass


class FileScanProviderInUseError(FileScanError):
    """The provider is selected by at least one policy and cannot be deleted."""


class FileScanBlockedError(FileScanError):
    """Raised by callers that stop a pipeline when ``ScanOutcome.allowed`` is false."""

    def __init__(self, outcome: ScanOutcome) -> None:
        super().__init__(outcome.describe())
        self.outcome = outcome

"""Framework-neutral errors shared by account application services."""


class AccountApplicationError(Exception):
    """Base class for failures owned by account application services."""


class AccountNotFoundError(AccountApplicationError):
    """The admitted account no longer exists."""

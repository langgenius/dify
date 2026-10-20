"""Safe diagnostic failure shared by native observation consumers."""


class NativeObservationError(RuntimeError):
    """Only fixed safe diagnostics leave a failed observation adapter."""

    def __init__(self) -> None:
        super().__init__("native_observation_failed")

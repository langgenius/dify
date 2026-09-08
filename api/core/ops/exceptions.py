"""Provider availability errors shared by tracing settings and API boundaries."""


class TraceProviderNotInstalledError(ImportError):
    def __init__(self, tracing_provider: str, module_name: str) -> None:
        super().__init__(f"Tracing provider {tracing_provider} requires the missing module {module_name}.")

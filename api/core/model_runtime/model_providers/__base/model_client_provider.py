from typing import Any


class ModelClientProvider:
    @staticmethod
    def get_service_client(credentials: dict = None, **kwargs: Any) -> Any:
        """
        Get an SDK client instance for model provider, if dedicate SDK available
        """
        raise NotImplementedError
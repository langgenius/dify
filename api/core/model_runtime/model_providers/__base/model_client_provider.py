from typing import Any, Optional


class ModelClientProvider:
    @staticmethod
    def get_service_client(credentials: Optional[dict] = None, **kwargs: Any) -> Any:
        """
        Get an SDK client instance for model provider, if dedicate SDK available
        """
        raise NotImplementedError
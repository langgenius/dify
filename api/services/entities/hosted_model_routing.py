"""Non-secret routing reference carried instead of source SYSTEM credentials."""

from typing import Any, override


# ModelRuntime accepts dict credentials end-to-end; no routing data becomes a dict entry.
class TokenerHostedModelCredentials(dict[str, Any]):  # noqa: FURB189
    """Internal typed marker for a hosted selection; never an app credential value.

    Only provider configuration can select this route. The transport checks all
    three identifiers against the operation and re-reads the current tenant
    binding before sending a key. A plain credential dict cannot opt in.
    """

    def __init__(self, *, tenant_id: str, provider: str, model_type: str, model: str) -> None:
        super().__init__()
        self.tenant_id = tenant_id
        self.provider = provider
        self.model_type = model_type
        self.model = model

    def __bool__(self) -> bool:
        """A valid route represents configured credentials, without a source key."""
        return True

    @override
    def copy(self) -> "TokenerHostedModelCredentials":
        """Maintain the trusted binding when an in-process consumer copies credentials."""
        return TokenerHostedModelCredentials(
            tenant_id=self.tenant_id, provider=self.provider, model_type=self.model_type, model=self.model
        )

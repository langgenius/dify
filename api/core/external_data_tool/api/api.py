from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, TypedDict, override

from sqlalchemy import select

from core.db.session_factory import session_factory
from core.extension.api_based_extension_requestor import APIBasedExtensionRequestor
from core.external_data_tool.base import ExternalDataTool
from core.helper import encrypter
from models.api_based_extension import APIBasedExtension, APIBasedExtensionPoint


@dataclass(frozen=True, slots=True)
class _ExtensionCredentials:
    """Immutable API extension connection details extracted from a closed DB session."""

    api_endpoint: str
    api_key: str


def _load_api_based_extension(tenant_id: str, api_based_extension_id: str) -> _ExtensionCredentials | None:
    """Load tenant-scoped API extension credentials in a short-lived session.

    Precondition: ``session_factory`` is configured and ``tenant_id`` / ``api_based_extension_id``
    identify the workspace and requested extension.
    Postcondition: the lookup session is closed before returning. Returns ``_ExtensionCredentials``
    when a matching row exists for ``tenant_id``, or ``None`` otherwise. No database state is modified.
    """
    stmt = select(APIBasedExtension).where(
        APIBasedExtension.tenant_id == tenant_id,
        APIBasedExtension.id == api_based_extension_id,
    )
    with session_factory.create_session() as session:
        api_based_extension = session.scalar(stmt)
        if api_based_extension is None:
            return None
        return _ExtensionCredentials(
            api_endpoint=api_based_extension.api_endpoint,
            api_key=api_based_extension.api_key,
        )


class ApiToolConfig(TypedDict, total=False):
    """Expected config shape for ApiExternalDataTool.

    Not used directly in method signatures (base class accepts dict[str, Any]);
    kept here to document the keys this tool reads from config.
    """

    api_based_extension_id: str


class ApiExternalDataTool(ExternalDataTool):
    """
    The api external data tool.
    """

    name: str = "api"
    """the unique name of external data tool"""

    @classmethod
    @override
    def validate_config(cls, tenant_id: str, config: dict[str, Any]):
        """Validate the incoming form config data against tenant-owned API extensions.

        Precondition: ``session_factory`` is configured and ``config`` is a mapping of tool fields.
        Postcondition: returns ``None`` only when ``api_based_extension_id`` exists for ``tenant_id``;
        otherwise raises ``ValueError``. Any opened database session is closed before returning or raising.
        """
        # own validation logic
        api_based_extension_id = config.get("api_based_extension_id")
        if not api_based_extension_id:
            raise ValueError("api_based_extension_id is required")

        if _load_api_based_extension(tenant_id=tenant_id, api_based_extension_id=api_based_extension_id) is None:
            raise ValueError("api_based_extension_id is invalid")

    @override
    def query(self, inputs: Mapping[str, Any], query: str | None = None) -> str:
        """Query the external data tool via its configured API-based extension.

        Precondition: ``self.config`` contains a non-null ``api_based_extension_id`` belonging to
        ``self.tenant_id`` and ``session_factory`` is configured.
        Postcondition: the lookup database session is closed before token decryption and outbound HTTP
        execution. Returns the string ``result`` from the extension response, or raises ``ValueError``
        (or ``AssertionError`` when ``api_based_extension_id`` is ``None``) without holding an open session.
        """
        # get params from config
        if not self.config:
            raise ValueError(f"config is required, config: {self.config}")
        api_based_extension_id = self.config.get("api_based_extension_id")
        assert api_based_extension_id is not None, "api_based_extension_id is required"

        credentials = _load_api_based_extension(
            tenant_id=self.tenant_id,
            api_based_extension_id=api_based_extension_id,
        )
        if credentials is None:
            raise ValueError(
                f"[External data tool] API query failed, variable: {self.variable}, "
                "error: api_based_extension_id is invalid"
            )

        # decrypt api_key
        api_key = encrypter.decrypt_token(tenant_id=self.tenant_id, token=credentials.api_key)

        try:
            # request api
            requestor = APIBasedExtensionRequestor(api_endpoint=credentials.api_endpoint, api_key=api_key)
        except Exception as e:
            raise ValueError(f"[External data tool] API query failed, variable: {self.variable}, error: {e}") from e

        response_json = requestor.request(
            point=APIBasedExtensionPoint.APP_EXTERNAL_DATA_TOOL_QUERY,
            params={"app_id": self.app_id, "tool_variable": self.variable, "inputs": inputs, "query": query},
        )

        if "result" not in response_json:
            raise ValueError(
                f"[External data tool] API query failed, variable: {self.variable}, error: result not found in response"
            )

        if not isinstance(response_json["result"], str):
            raise ValueError(
                f"[External data tool] API query failed, variable: {self.variable}, error: result is not string"
            )

        return response_json["result"]

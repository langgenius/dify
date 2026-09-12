"""Credential fallback policy shared by stored Notion preview and indexing."""

import logging
from collections.abc import Callable

logger = logging.getLogger(__name__)


class NotionCredentialUnavailableError(ValueError):
    pass


def resolve_stored_notion_access_token(
    *,
    credential_id: str | None,
    load_token: Callable[[str], str],
    integration_token: str | None,
) -> str:
    """Use the saved credential, then the configured legacy integration.

    Stored documents never select a tenant default credential: changing that
    default must not change the integration used to read an existing document.
    Preserve indexing's environment fallback when credential resolution fails,
    including refresh failures. Actor-selected imports do not use this policy.
    """
    credential_error: Exception | None = None
    if credential_id:
        try:
            token = load_token(credential_id)
            if isinstance(token, str) and token:
                return token
        except Exception as error:
            credential_error = error

    if not integration_token:
        raise NotionCredentialUnavailableError(
            "Must specify `integration_token` or set environment variable `NOTION_INTEGRATION_TOKEN`."
        ) from credential_error

    logger.warning("Stored Notion credential %s unavailable; using NOTION_INTEGRATION_TOKEN", credential_id)
    return integration_token

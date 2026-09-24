"""Vend API Merchant — Dify Tool Provider.

Calls Vend pay-per-call endpoints (extract, web-search) which answer HTTP 402
with an x402 v2 challenge settled in Nano (XNO). No API key required: the
endpoint returns the payment challenge, and after the user settles the Nano
payment on-chain, the block hash is passed back via the provider `payment_header`
credential (the X-PAYMENT header) to fetch the data.

The provider is intentionally cheap on credentials: the default base URL points
at the live public Vend endpoint. Payment is per-call; a settled block hash can
be shared across calls within its validity window.
"""

from collections.abc import Generator

from dify_plugin import ToolProvider
from dify_plugin.entities.tool import ToolInvokeMessage
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

import httpx


def _base_url(runtime: dict) -> str:
    # Dify injects provider credentials into runtime; fall back to the live host.
    creds = runtime.get("credentials") or {}
    return (creds.get("vend_base_url") or "https://extract.paypercall.dev").rstrip("/")


def _check(api_key: str) -> None:
    # Validate connectivity by probing the extract endpoint (unpaid -> 402).
    try:
        resp = httpx.get(
            f"{_base_url({'credentials': {'vend_base_url': api_key}})}/api/v1/extract",
            params={"url": "https://example.com"},
            timeout=15,
        )
    except httpx.HTTPError as exc:  # noqa: BLE001
        raise ToolProviderCredentialValidationError(f"cannot reach Vend: {exc}")
    if resp.status_code not in (402, 200):
        raise ToolProviderCredentialValidationError(f"Vend answered {resp.status_code}")


class VendApiMerchantProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict) -> None:
        _check(credentials.get("vend_base_url") or "https://extract.paypercall.dev")


def build_tool_call(endpoint: str, params: dict, payment_header: str | None, base_url: str) -> Generator[ToolInvokeMessage, None, None]:
    """Shared x402 caller for the two Vend tools."""
    headers = {}
    if payment_header:
        headers["X-PAYMENT"] = payment_header
    resp = httpx.get(f"{base_url}/api/v1/{endpoint}", params=params, headers=headers, timeout=30)
    if resp.status_code == 402:
        challenge = resp.json()
        msg = challenge.get("message", "Payment required")
        yield ToolInvokeMessage(type="text", content=msg)
        yield ToolInvokeMessage(
            type="json",
            data={
                "payment_required": True,
                "price_xno": challenge.get("price_xno"),
                "pay_to": challenge.get("pay_to"),
                "accepts": challenge.get("accepts", [{}]),
                "how": "Send the price in XNO to pay_to, then set the provider's X-PAYMENT block hash and retry.",
            },
        )
        return
    if resp.status_code != 200:
        yield ToolInvokeMessage(type="text", content=f"Vend error {resp.status_code}: {resp.text[:200]}")
        return
    yield ToolInvokeMessage(type="json", data=resp.json())

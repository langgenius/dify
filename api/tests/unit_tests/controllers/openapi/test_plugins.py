import httpx
import pytest

from controllers.openapi._errors import MarketplaceUnavailable
from controllers.openapi.plugins import _plugin_errors


def test_marketplace_network_failure_is_marketplace_unavailable() -> None:
    with pytest.raises(MarketplaceUnavailable):
        with _plugin_errors():
            raise httpx.ConnectError("marketplace unreachable")

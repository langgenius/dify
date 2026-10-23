import httpx
import pytest

from controllers.openapi._errors import MarketplaceUnavailable
from controllers.openapi._plugin_errors import plugin_errors


def test_marketplace_network_failure_is_marketplace_unavailable() -> None:
    with pytest.raises(MarketplaceUnavailable):
        with plugin_errors():
            raise httpx.ConnectError("marketplace unreachable")

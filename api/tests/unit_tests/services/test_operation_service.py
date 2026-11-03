"""OperationService delegates to the generated saas client; HTTP behavior is covered in billing_client."""

from unittest.mock import patch

import pytest

from services.billing_client import saas
from services.operation_service import OperationService, UtmInfo

TENANT_ID = "tenant-123"


@pytest.mark.parametrize(
    ("utm_info", "expected"),
    [
        (
            {
                "utm_source": "google",
                "utm_medium": "cpc",
                "utm_campaign": "spring_sale",
                "utm_content": "ad_1",
                "utm_term": "ai_agent",
            },
            saas.TenantUtmRequest(
                tenant_id=TENANT_ID,
                utm_source="google",
                utm_medium="cpc",
                utm_campaign="spring_sale",
                utm_content="ad_1",
                utm_term="ai_agent",
            ),
        ),
        (
            {},
            saas.TenantUtmRequest(
                tenant_id=TENANT_ID, utm_source="", utm_medium="", utm_campaign="", utm_content="", utm_term=""
            ),
        ),
        (
            {"utm_source": "newsletter"},
            saas.TenantUtmRequest(
                tenant_id=TENANT_ID,
                utm_source="newsletter",
                utm_medium="",
                utm_campaign="",
                utm_content="",
                utm_term="",
            ),
        ),
    ],
)
def test_record_utm_defaults_missing_fields_to_empty_strings(
    utm_info: UtmInfo, expected: saas.TenantUtmRequest
) -> None:
    reply = saas.TenantUtmReply(result="ok")

    with patch.object(saas, "utm_record_tenant_utm", return_value=reply) as record:
        result = OperationService.record_utm(TENANT_ID, utm_info)

    assert result is reply
    record.assert_called_once_with(body=expected)

from typing import TypedDict

from services.billing_client import saas


class UtmInfo(TypedDict, total=False):
    """Expected shape of the utm_info dict passed to record_utm.

    All fields are optional; missing keys default to an empty string.
    """

    utm_source: str
    utm_medium: str
    utm_campaign: str
    utm_content: str
    utm_term: str


class OperationService:
    @classmethod
    def record_utm(cls, tenant_id: str, utm_info: UtmInfo) -> saas.TenantUtmReply:
        return saas.utm_record_tenant_utm(
            body=saas.TenantUtmRequest(
                tenant_id=tenant_id,
                utm_source=utm_info.get("utm_source", ""),
                utm_medium=utm_info.get("utm_medium", ""),
                utm_campaign=utm_info.get("utm_campaign", ""),
                utm_content=utm_info.get("utm_content", ""),
                utm_term=utm_info.get("utm_term", ""),
            )
        )

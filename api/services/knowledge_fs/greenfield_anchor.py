"""Identity of the audit-only control space created for an empty Workspace."""

from uuid import NAMESPACE_URL, uuid5


def greenfield_activation_identity(tenant_id: str) -> tuple[str, str]:
    provisioning_key = f"dify-kfs-greenfield-activation:{tenant_id}"
    return str(uuid5(NAMESPACE_URL, provisioning_key)), provisioning_key

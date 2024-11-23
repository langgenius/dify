from models.account import TenantAccountRole


def test_account_is_privileged_role() -> None:
    assert TenantAccountRole.ADMIN == "admin"
    assert TenantAccountRole.OWNER == "owner"
    assert TenantAccountRole.EDITOR == "editor"
    assert TenantAccountRole.NORMAL == "normal"

    assert TenantAccountRole.is_privileged_role(TenantAccountRole.ADMIN)
    assert TenantAccountRole.is_privileged_role(TenantAccountRole.OWNER)
    assert not TenantAccountRole.is_privileged_role(TenantAccountRole.NORMAL)
    assert not TenantAccountRole.is_privileged_role(TenantAccountRole.EDITOR)
    assert not TenantAccountRole.is_privileged_role("")

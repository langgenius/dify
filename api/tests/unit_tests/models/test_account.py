from models.account import AccountRole


def test_account_roles() -> None:
    privileged_roles = AccountRole.get_privileged_roles()
    assert privileged_roles == {'admin', 'owner'}
    assert 'admin' in privileged_roles
    assert 'owner' in privileged_roles
    assert 'normal' not in privileged_roles

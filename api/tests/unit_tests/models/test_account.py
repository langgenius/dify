from models.account import AccountRole


def test_account_roles() -> None:
    privilieged_roles = AccountRole.get_privilieged_roles()
    assert privilieged_roles == {'admin', 'owner'}
    assert 'admin' in privilieged_roles
    assert 'owner' in privilieged_roles
    assert 'normal' not in privilieged_roles

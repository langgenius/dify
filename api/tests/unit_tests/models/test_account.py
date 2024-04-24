from models.account import get_privilieged_roles


def test_account_roles() -> None:
    roles = get_privilieged_roles()
    assert roles == {'admin', 'owner'}
    assert 'admin' in roles
    assert 'owner' in roles
    assert 'normal' not in roles

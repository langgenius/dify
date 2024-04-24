from models.account import AccountRole


def test_account_is_privileged_role() -> None:
    assert AccountRole.ADMIN == 'admin'
    assert AccountRole.OWNER == 'owner'
    assert AccountRole.NORMAL == 'normal'

    assert AccountRole.is_privileged_role(AccountRole.ADMIN)
    assert AccountRole.is_privileged_role(AccountRole.OWNER)
    assert not AccountRole.is_privileged_role(AccountRole.NORMAL)
    assert not AccountRole.is_privileged_role('')

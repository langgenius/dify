from models.account import AccountRole


def test_account_is_privileged_role() -> None:
    assert AccountRole.is_privileged_role(AccountRole.ADMIN.value)
    assert AccountRole.is_privileged_role(AccountRole.OWNER.value)
    assert not AccountRole.is_privileged_role(AccountRole.NORMAL.value)

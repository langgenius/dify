import pytest

from constants.oauth_bearer import OAuthScope

READ_ONLY = frozenset({OAuthScope.READ})
READ_WRITE = frozenset({OAuthScope.READ, OAuthScope.WRITE})


@pytest.mark.parametrize(
    ("value", "granted"),
    [
        pytest.param(None, READ_WRITE, id="absent"),
        pytest.param("", READ_WRITE, id="empty"),
        pytest.param("read", READ_ONLY, id="read"),
        pytest.param("write", READ_WRITE, id="write-implies-read"),
        pytest.param("read write", READ_WRITE, id="read-write"),
        pytest.param("offline_access", READ_WRITE, id="offline-access-alone"),
        pytest.param("offline_access read", READ_ONLY, id="offline-access-mixed"),
        pytest.param("  read   offline_access ", READ_ONLY, id="extra-spaces"),
        pytest.param("read read", READ_ONLY, id="repeated"),
    ],
)
def test_parse_grants_read_or_read_write(value: str | None, granted: frozenset[OAuthScope]) -> None:
    assert OAuthScope.parse(value) == granted


@pytest.mark.parametrize(
    "value",
    [
        pytest.param("admin", id="unknown"),
        pytest.param("read admin", id="unknown-mixed"),
        pytest.param("READ", id="case-sensitive"),
        pytest.param("read\twrite", id="tab-is-not-a-separator"),
        pytest.param("apps:run", id="internal-scope"),
    ],
)
def test_parse_refuses_unknown_names(value: str) -> None:
    with pytest.raises(ValueError, match="is not a valid OAuthScope"):
        OAuthScope.parse(value)


def test_serialize_is_space_separated_in_declaration_order() -> None:
    assert OAuthScope.serialize(frozenset({OAuthScope.WRITE, OAuthScope.READ})) == "read write"
    assert OAuthScope.serialize(READ_ONLY) == "read"
    assert OAuthScope.parse(OAuthScope.serialize(READ_ONLY)) == READ_ONLY

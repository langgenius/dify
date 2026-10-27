from collections.abc import Iterator
from typing import cast

import pytest
from click.testing import CliRunner, Result
from sqlalchemy import Engine, Table, create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from commands import oauth_client
from core.db.session_factory import session_factory
from enums.oauth_client import OAuthClientKind
from models.model import OAuthProviderApp
from models.oauth import OpenAPIOAuthClient
from services.oauth_clients import hash_client_secret
from services.oauth_token_contracts import GrantType

REDIRECT = "https://example.com/cb"


@pytest.fixture
def engine(monkeypatch: pytest.MonkeyPatch) -> Iterator[Engine]:
    engine = create_engine("sqlite://")
    cast(Table, OpenAPIOAuthClient.__table__).create(engine)
    cast(Table, OAuthProviderApp.__table__).create(engine)
    maker = sessionmaker(engine, class_=Session)
    monkeypatch.setattr(session_factory, "get_session_maker", lambda: maker)
    yield engine
    engine.dispose()


def _create(*args: str) -> Result:
    return CliRunner().invoke(oauth_client, ["create", *args])


def _rows(engine: Engine) -> list[OpenAPIOAuthClient]:
    with Session(engine) as session:
        return list(session.scalars(select(OpenAPIOAuthClient)))


def test_creates_public_client(engine: Engine) -> None:
    result = _create("--client-id", "my-cli", "--name", "My CLI", "--redirect-uri", "http://127.0.0.1/cb")

    assert result.exit_code == 0, result.output
    [row] = _rows(engine)
    assert row.kind == OAuthClientKind.PUBLIC
    assert row.client_secret_hash is None
    assert row.redirect_uris == ["http://127.0.0.1/cb"]
    assert row.grant_types == [GrantType.AUTHORIZATION_CODE.value, GrantType.REFRESH_TOKEN.value]
    assert "secret" not in result.output.lower()


def test_creates_confidential_client_and_stores_only_hash(engine: Engine) -> None:
    result = _create(
        "--client-id", "nango", "--name", "Nango", "--redirect-uri", REDIRECT, "--confidential",
        "--logo-uri", "https://example.com/l.png",
    )  # fmt: skip

    assert result.exit_code == 0, result.output
    [row] = _rows(engine)
    assert row.kind == OAuthClientKind.CONFIDENTIAL
    assert row.logo_uri == "https://example.com/l.png"
    secret = result.output.split("client_secret:")[1].split()[0]
    assert len(secret) >= 43
    assert row.client_secret_hash == hash_client_secret(secret)
    assert secret not in (row.client_secret_hash or "")


def test_explicit_grant_types_replace_default(engine: Engine) -> None:
    result = _create(
        "--client-id", "dev", "--name", "Dev", "--redirect-uri", REDIRECT,
        "--grant-type", "authorization_code",
    )  # fmt: skip

    assert result.exit_code == 0, result.output
    assert _rows(engine)[0].grant_types == [GrantType.AUTHORIZATION_CODE.value]


def test_unknown_grant_type_is_usage_error(engine: Engine) -> None:
    result = _create(
        "--client-id", "dev", "--name", "Dev", "--redirect-uri", REDIRECT, "--grant-type", "password"
    )  # fmt: skip

    assert result.exit_code == 2
    assert _rows(engine) == []


@pytest.mark.parametrize("client_id", ["dcr_abc", "cimd:https://x.example/c", "x" * 65, ""])
def test_rejects_reserved_or_oversized_client_id(engine: Engine, client_id: str) -> None:
    result = _create("--client-id", client_id, "--name", "N", "--redirect-uri", REDIRECT)

    assert result.exit_code != 0
    assert _rows(engine) == []


def test_accepts_client_id_at_max_length(engine: Engine) -> None:
    result = _create("--client-id", "x" * 64, "--name", "N", "--redirect-uri", REDIRECT)

    assert result.exit_code == 0, result.output
    assert len(_rows(engine)) == 1


def test_rejects_existing_client_id(engine: Engine) -> None:
    assert _create("--client-id", "dup", "--name", "N", "--redirect-uri", REDIRECT).exit_code == 0

    result = _create("--client-id", "dup", "--name", "N", "--redirect-uri", REDIRECT)

    assert result.exit_code != 0
    assert len(_rows(engine)) == 1


def test_rejects_provider_app_clash(engine: Engine) -> None:
    with Session(engine) as session:
        session.add(
            OAuthProviderApp(
                app_icon="", client_id="taken", client_secret="s", app_label={}, redirect_uris=[], scope="read"
            )
        )
        session.commit()

    result = _create("--client-id", "taken", "--name", "N", "--redirect-uri", REDIRECT)

    assert result.exit_code != 0
    assert _rows(engine) == []


@pytest.mark.parametrize("redirect", ["http://example.com/cb", "https://example.com/cb#f", "myapp://cb"])
def test_rejects_invalid_redirect(engine: Engine, redirect: str) -> None:
    result = _create("--client-id", "c", "--name", "N", "--redirect-uri", redirect)

    assert result.exit_code != 0
    assert _rows(engine) == []


def test_requires_a_redirect_uri(engine: Engine) -> None:
    result = _create("--client-id", "c", "--name", "N")

    assert result.exit_code == 2
    assert _rows(engine) == []


def test_accepts_https_logo(engine: Engine) -> None:
    result = _create(
        "--client-id", "c", "--name", "N", "--redirect-uri", REDIRECT, "--logo-uri", "https://example.com/x.png"
    )  # fmt: skip

    assert result.exit_code == 0, result.output
    assert _rows(engine)[0].logo_uri == "https://example.com/x.png"


@pytest.mark.parametrize(
    "logo", ["http://example.com/x.png", "javascript:alert(1)", "http://localhost/x.png", "https://example.com/x#f"]
)
def test_rejects_invalid_logo(engine: Engine, logo: str) -> None:
    result = _create("--client-id", "c", "--name", "N", "--redirect-uri", REDIRECT, "--logo-uri", logo)

    assert result.exit_code == 2
    assert _rows(engine) == []


@pytest.mark.parametrize("grant_type", [GrantType.DEVICE_CODE.value, "client_credentials"])
def test_offers_only_browser_grant_types(engine: Engine, grant_type: str) -> None:
    result = _create(
        "--client-id", "dev", "--name", "Dev", "--redirect-uri", REDIRECT, "--grant-type", grant_type
    )  # fmt: skip

    assert result.exit_code == 2
    assert _rows(engine) == []


def test_refresh_only_client_is_usage_error(engine: Engine) -> None:
    result = _create(
        "--client-id", "dev", "--name", "Dev", "--redirect-uri", REDIRECT, "--grant-type", "refresh_token"
    )  # fmt: skip

    assert result.exit_code == 2
    assert "authorization_code" in result.output
    assert _rows(engine) == []


@pytest.mark.parametrize("name", ["", "   "])
def test_rejects_an_empty_name(engine: Engine, name: str) -> None:
    result = _create("--client-id", "c", "--name", name, "--redirect-uri", REDIRECT)

    assert result.exit_code == 2
    assert _rows(engine) == []

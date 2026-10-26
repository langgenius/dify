import secrets
from collections.abc import Sequence

import click

from core.db.session_factory import session_factory
from enums.oauth_client import OAuthClientKind
from repositories.oauth_client_repository import SQLAlchemyOAuthClientRepository
from services.oauth_clients import hash_client_secret
from services.oauth_redirect import is_valid_redirect_uri
from services.oauth_token_contracts import GrantType

RESERVED_CLIENT_ID_PREFIXES = ("dcr_", "cimd:")
CLIENT_ID_MAX_LENGTH = 64
CLIENT_SECRET_BYTES = 32
DEFAULT_GRANT_TYPES = (GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN)


@click.group("oauth-client", help="Manage pre-registered OAuth clients.")
def oauth_client() -> None:
    """Namespace for OAuth client commands."""


def _validate_client_id(repository: SQLAlchemyOAuthClientRepository, client_id: str) -> None:
    if not client_id or len(client_id) > CLIENT_ID_MAX_LENGTH:
        raise click.UsageError(f"client id must be 1-{CLIENT_ID_MAX_LENGTH} characters")
    for prefix in RESERVED_CLIENT_ID_PREFIXES:
        if client_id.startswith(prefix):
            raise click.UsageError(f"client id must not start with the reserved prefix {prefix!r}")
    if repository.provider_app_exists(client_id) or repository.resolve(client_id) is not None:
        raise click.UsageError(f"client id {client_id!r} already exists")


def _validate_redirect_uris(redirect_uris: Sequence[str]) -> None:
    for uri in redirect_uris:
        if not is_valid_redirect_uri(uri):
            raise click.UsageError(f"invalid redirect uri {uri!r}: use https, or http on a loopback host")


@oauth_client.command("create", help="Pre-register an OAuth client.")
@click.option("--client-id", required=True, help="Unique client id.")
@click.option("--name", "display_name", required=True, help="Name shown on the consent page.")
@click.option("--redirect-uri", "redirect_uris", multiple=True, required=True, help="Allowed redirect URI. Repeatable.")
@click.option("--confidential", is_flag=True, default=False, help="Create a confidential client with a secret.")
@click.option(
    "--grant-type",
    "grant_types",
    multiple=True,
    type=click.Choice([grant.value for grant in GrantType]),
    help="Allowed grant type. Repeatable. Default: authorization_code and refresh_token.",
)
@click.option("--logo-uri", default=None, help="Logo URL shown on the consent page.")
def create(
    client_id: str,
    display_name: str,
    redirect_uris: tuple[str, ...],
    confidential: bool,
    grant_types: tuple[str, ...],
    logo_uri: str | None,
) -> None:
    repository = SQLAlchemyOAuthClientRepository(session_factory=session_factory.get_session_maker())
    _validate_client_id(repository, client_id)
    _validate_redirect_uris(redirect_uris)

    secret = secrets.token_urlsafe(CLIENT_SECRET_BYTES) if confidential else None
    repository.create(
        client_id=client_id,
        kind=OAuthClientKind.CONFIDENTIAL if confidential else OAuthClientKind.PUBLIC,
        display_name=display_name,
        redirect_uris=redirect_uris,
        grant_types=[GrantType(value) for value in grant_types] or DEFAULT_GRANT_TYPES,
        client_secret_hash=hash_client_secret(secret) if secret else None,
        logo_uri=logo_uri,
    )
    click.echo(f"Created OAuth client {client_id!r}.")
    if secret:
        click.echo(f"client_secret: {secret}")
        click.echo("Store this secret now. It is not shown again.")

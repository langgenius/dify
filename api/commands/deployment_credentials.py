"""Explicit, idempotent initialization for migrated installations."""

import click

from libs.credential_cipher import CredentialCipherError
from services.deployment_credential_composition import build_deployment_credential_service


@click.command("provision-deployment-credential-key")
def provision_deployment_credential_key() -> None:
    """Require stable setup; create/recover the deployment key without printing its reference."""
    try:
        build_deployment_credential_service().provision()
    except CredentialCipherError:
        raise click.ClickException("Deployment credential key initialization failed") from None
    click.echo("Deployment credential key is initialized.")

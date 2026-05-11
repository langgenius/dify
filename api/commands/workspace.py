"""Workspace maintenance CLI commands."""

import click
from sqlalchemy import delete, select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from extensions.ext_database import db
from libs.rsa import generate_key_pair
from models import Tenant
from models.provider import Provider, ProviderModel
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider


@click.command(
    "reset-encrypt-key-pair",
    help="Reset the asymmetric key pair of workspace for encrypt LLM credentials. "
    "After the reset, all LLM credentials and tool provider credentials "
    "(builtin / API / MCP) will be purged, requiring re-entry. "
    "Only support SELF_HOSTED mode.",
)
@click.confirmation_option(
    prompt=click.style(
        "Are you sure you want to reset encrypt key pair? "
        "This will also purge builtin / API / MCP tool provider records for every tenant. "
        "This operation cannot be rolled back!",
        fg="red",
    )
)
def reset_encrypt_key_pair() -> None:
    """
    Reset the encrypted key pair of workspace for encrypt LLM credentials.
    After the reset, all LLM credentials will become invalid, requiring re-entry.
    Only support SELF_HOSTED mode.
    """
    if dify_config.EDITION != "SELF_HOSTED":
        click.echo(click.style("This command is only for SELF_HOSTED installations.", fg="red"))
        return
    with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
        tenants = session.scalars(select(Tenant)).all()
        for tenant in tenants:
            if not tenant:
                click.echo(click.style("No workspaces found. Run /install first.", fg="red"))
                return

            tenant.encrypt_public_key = generate_key_pair(tenant.id)

            session.execute(delete(Provider).where(Provider.provider_type == "custom", Provider.tenant_id == tenant.id))
            session.execute(delete(ProviderModel).where(ProviderModel.tenant_id == tenant.id))

            # Purge tool provider records that hold credentials encrypted under the
            # tenant key. Leaving them in place causes /console/api/workspaces/current/
            # tool-providers to 500 because decryption fails on stale ciphertext (#35396).
            session.execute(delete(BuiltinToolProvider).where(BuiltinToolProvider.tenant_id == tenant.id))
            session.execute(delete(ApiToolProvider).where(ApiToolProvider.tenant_id == tenant.id))
            session.execute(delete(MCPToolProvider).where(MCPToolProvider.tenant_id == tenant.id))

            click.echo(
                click.style(
                    f"Congratulations! The asymmetric key pair of workspace {tenant.id} has been reset.",
                    fg="green",
                )
            )

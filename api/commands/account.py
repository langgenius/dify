import base64
import secrets

import click
from sqlalchemy.orm import sessionmaker

from constants.languages import languages
from extensions.ext_database import db
from libs.helper import email as email_validate
from libs.password import hash_password, password_pattern, valid_password
from services.account_service import AccountService, RegisterService, TenantService


@click.command("reset-password", help="Reset the account password.")
@click.option("--email", prompt=True, help="Account email to reset password for")
@click.option("--new-password", prompt=True, help="New password")
@click.option("--password-confirm", prompt=True, help="Confirm new password")
def reset_password(email, new_password, password_confirm):
    """
    Reset password of owner account
    Only available in SELF_HOSTED mode
    """
    if str(new_password).strip() != str(password_confirm).strip():
        click.echo(click.style("Passwords do not match.", fg="red"))
        return
    normalized_email = email.strip().lower()

    with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
        account = AccountService.get_account_by_email_with_case_fallback(email.strip(), session=session)

        if not account:
            click.echo(click.style(f"Account not found for email: {email}", fg="red"))
            return

        try:
            valid_password(new_password)
        except:
            click.echo(click.style(f"Invalid password. Must match {password_pattern}", fg="red"))
            return

        # generate password salt
        salt = secrets.token_bytes(16)
        base64_salt = base64.b64encode(salt).decode()

        # encrypt password with salt
        password_hashed = hash_password(new_password, salt)
        base64_password_hashed = base64.b64encode(password_hashed).decode()
        account.password = base64_password_hashed
        account.password_salt = base64_salt
        AccountService.reset_login_error_rate_limit(normalized_email)
        click.echo(click.style("Password reset successfully.", fg="green"))


@click.command("reset-email", help="Reset the account email.")
@click.option("--email", prompt=True, help="Current account email")
@click.option("--new-email", prompt=True, help="New email")
@click.option("--email-confirm", prompt=True, help="Confirm new email")
def reset_email(email, new_email, email_confirm):
    """
    Replace account email
    :return:
    """
    if str(new_email).strip() != str(email_confirm).strip():
        click.echo(click.style("New emails do not match.", fg="red"))
        return
    normalized_new_email = new_email.strip().lower()

    with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
        account = AccountService.get_account_by_email_with_case_fallback(email.strip(), session=session)

        if not account:
            click.echo(click.style(f"Account not found for email: {email}", fg="red"))
            return

        try:
            email_validate(normalized_new_email)
        except:
            click.echo(click.style(f"Invalid email: {new_email}", fg="red"))
            return

        account.email = normalized_new_email
        click.echo(click.style("Email updated successfully.", fg="green"))


@click.command("create-tenant", help="Create account and tenant.")
@click.option("--email", prompt=True, help="Tenant account email.")
@click.option("--name", prompt=True, help="Workspace name.")
@click.option("--language", prompt=True, help="Account language, default: en-US.")
def create_tenant(email: str, language: str | None = None, name: str | None = None):
    """
    Create tenant account
    """
    if not email:
        click.echo(click.style("Email is required.", fg="red"))
        return

    # Create account
    email = email.strip().lower()

    if "@" not in email:
        click.echo(click.style("Invalid email address.", fg="red"))
        return

    account_name = email.split("@")[0]

    if language not in languages:
        language = "en-US"

    # Validates name encoding for non-Latin characters.
    name = name.strip().encode("utf-8").decode("utf-8") if name else None

    # generate random password
    new_password = secrets.token_urlsafe(16)

    # register account
    account = RegisterService.register(
        email=email,
        name=account_name,
        password=new_password,
        language=language,
        create_workspace_required=False,
    )
    TenantService.create_owner_tenant_if_not_exist(account, name)

    click.echo(
        click.style(
            f"Account and tenant created.\nAccount: {email}\nPassword: {new_password}",
            fg="green",
        )
    )

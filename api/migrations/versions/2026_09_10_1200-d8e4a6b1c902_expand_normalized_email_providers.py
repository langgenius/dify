"""Expand account email normalization to Microsoft, Apple, and Proton.

Keep these rules self-contained so future runtime policy changes cannot alter
historical migrations. Equivalent existing accounts retain their nonunique
normalized values and their original email addresses.

Policy sources:
- Microsoft +site delivery (preserve dots and domains):
  https://support.microsoft.com/en-us/outlook/send-email-from-a-different-address-in-outlook-com
- Apple legacy domain association for eligible migrated accounts:
  https://support.apple.com/en-us/118230
  +tag delivery was manually verified by linw1995 on 2026-09-10;
  the official source covers legacy domains, not +tag delivery.
- Proton +aliases and consumer domains:
  https://proton.me/support/addresses-and-aliases
- Proton transparent username characters (dots, underscores, and hyphens):
  https://proton.me/support/change-username
"""

import sqlalchemy as sa
from alembic import op

revision = "d8e4a6b1c902"
down_revision = "c3f1a9b2e6d4"
branch_labels = None
depends_on = None

_MICROSOFT_DOMAINS = ("outlook.com", "hotmail.com", "live.com", "msn.com")
_APPLE_DOMAINS = ("icloud.com", "me.com", "mac.com")
_PROTON_DOMAINS = ("protonmail.com", "proton.me", "pm.me", "protonmail.ch")


def _backfill_normalized_emails(*, restore: bool = False) -> None:
    dialect = op.get_context().dialect.name
    email = sa.func.lower(sa.column("email"))
    if dialect == "postgresql":
        domain = sa.func.split_part(email, "@", 2)
        local_part = sa.func.split_part(sa.func.split_part(email, "@", 1), "+", 1)
    elif dialect in {"mysql", "mariadb"}:
        domain = sa.func.substring_index(email, "@", -1)
        local_part = sa.func.substring_index(sa.func.substring_index(email, "@", 1), "+", 1)
    elif dialect == "sqlite":
        domain = sa.func.substr(email, sa.func.instr(email, "@") + 1)
        local = sa.func.substr(email, 1, sa.func.instr(email, "@") - 1)
        tagged_local = sa.cast(local, sa.String) + "+"
        local_part = sa.func.substr(local, 1, sa.func.instr(tagged_local, "+") - 1)
    else:
        raise RuntimeError(f"Unsupported database dialect for normalized email migration: {dialect}")

    normalized_local = sa.case(
        (
            domain.in_(_PROTON_DOMAINS),
            sa.func.replace(sa.func.replace(sa.func.replace(local_part, ".", ""), "_", ""), "-", ""),
        ),
        else_=local_part,
    )
    normalized_domain = sa.case((domain.in_(_APPLE_DOMAINS), "icloud.com"), else_=domain)
    normalized_email = sa.cast(normalized_local, sa.String) + "@" + sa.cast(normalized_domain, sa.String)
    accounts = sa.table("accounts", sa.column("email"), sa.column("normalized_email"))
    statement = (
        accounts.update()
        .where(domain.in_(_MICROSOFT_DOMAINS + _APPLE_DOMAINS + _PROTON_DOMAINS))
        .values(normalized_email=email if restore else normalized_email)
    )
    # Render the fixed policy constants so offline migrations are executable too.
    op.execute(str(statement.compile(dialect=op.get_context().dialect, compile_kwargs={"literal_binds": True})))


def upgrade() -> None:
    _backfill_normalized_emails()


def downgrade() -> None:
    _backfill_normalized_emails(restore=True)

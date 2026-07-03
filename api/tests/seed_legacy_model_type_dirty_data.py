from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

API_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(API_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(API_PROJECT_ROOT))

import sqlalchemy as sa

from tests.helpers.legacy_model_type_migration import (
    DEFAULT_PRIMARY_TENANT_ID,
    DEFAULT_SECONDARY_TENANT_ID,
    create_minimal_legacy_model_type_schema,
    seed_legacy_model_type_dirty_data,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Seed dirty legacy model_type rows for manual migration experiments. "
            "Example: uv run --project api python api/tests/seed_legacy_model_type_dirty_data.py "
            "--db-url postgresql://postgres:postgres@127.0.0.1:5432/dify"
        )
    )
    parser.add_argument("--db-url", required=True, help="SQLAlchemy database URL for the target database.")
    parser.add_argument(
        "--primary-tenant-id",
        default=DEFAULT_PRIMARY_TENANT_ID,
        help="Tenant that will contain the main conflict scenario.",
    )
    parser.add_argument(
        "--secondary-tenant-id",
        default=DEFAULT_SECONDARY_TENANT_ID,
        help="Tenant used to verify tenant filtering behavior.",
    )
    parser.add_argument(
        "--create-minimal-schema",
        action="store_true",
        help="Create the minimal tables needed for the seed when running against an empty scratch database.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    engine = sa.create_engine(args.db_url)
    try:
        if args.create_minimal_schema:
            create_minimal_legacy_model_type_schema(engine)

        fixture = seed_legacy_model_type_dirty_data(
            engine,
            primary_tenant_id=args.primary_tenant_id,
            secondary_tenant_id=args.secondary_tenant_id,
        )
    finally:
        engine.dispose()

    print(
        json.dumps(
            {
                "primary_tenant_id": fixture.primary.tenant_id,
                "secondary_tenant_id": fixture.secondary.tenant_id,
                "winner_credential_id": fixture.primary.winner_credential_id,
                "loser_credential_id": fixture.primary.loser_credential_id,
                "provider_model_id": fixture.primary.provider_model_id,
                "load_balancing_config_id": fixture.primary.load_balancing_config_id,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

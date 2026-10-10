from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_skill_maintainer_migration_roundtrip() -> None:
    paths = list((Path(__file__).parents[3] / "migrations/versions").glob("*_add_skill_maintainer.py"))
    assert len(paths) == 1
    spec = spec_from_file_location("skill_maintainer_migration", paths[0])
    assert spec is not None
    assert spec.loader is not None
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(
            sa.text("CREATE TABLE skills (id TEXT PRIMARY KEY, tenant_id TEXT, created_by TEXT, name TEXT)")
        )
        connection.execute(
            sa.text("INSERT INTO skills VALUES (:id, 'tenant', :creator, 'original')"),
            [
                {"id": "normal", "creator": "11111111-1111-1111-1111-111111111111"},
                {"id": "null", "creator": None},
                {"id": "removed", "creator": "22222222-2222-2222-2222-222222222222"},
            ],
        )
        migration.__dict__["op"] = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        rows = connection.execute(sa.text("SELECT created_by, maintainer FROM skills")).all()
        assert all(creator == maintainer for creator, maintainer in rows)
        assert "skills_tenant_maintainer_idx" in {i["name"] for i in sa.inspect(connection).get_indexes("skills")}
        migration.downgrade()
        assert "maintainer" not in {c["name"] for c in sa.inspect(connection).get_columns("skills")}
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM skills WHERE name = 'original'")) == 3
    engine.dispose()

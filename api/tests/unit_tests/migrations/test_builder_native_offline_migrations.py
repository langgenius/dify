"""Native migration exports retain trigger protections and downgrade evidence guards."""

import logging
import logging.config
from io import StringIO
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from flask import Flask
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy

_MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "migrations"


@pytest.mark.parametrize("dialect", ["postgresql", "mysql"])
@pytest.mark.parametrize("upgrade", [True, False], ids=["upgrade", "downgrade"])
def test_native_migrations_export_sql_without_database_reads(
    dialect: str, upgrade: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = StringIO()
    # The real environment always applies the CLI log ini, which closes handlers
    # and disables unrelated application loggers. Only isolate that setup hook.
    config = Config(str(_MIGRATIONS_DIR / "alembic.ini"), output_buffer=output)
    monkeypatch.setattr(logging.config, "fileConfig", lambda *_args, **_kwargs: None)
    loggers = [
        logging.getLogger(),
        *(logger for logger in logging.Logger.manager.loggerDict.copy().values() if isinstance(logger, logging.Logger)),
    ]
    routes = {
        logger: (logger.disabled, logger.level, logger.propagate, tuple(logger.handlers), tuple(logger.filters))
        for logger in loggers
    }
    config.set_main_option("script_location", str(_MIGRATIONS_DIR))
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "postgresql://" if dialect == "postgresql" else "mysql+pymysql://"
    database = SQLAlchemy(app)
    Migrate(app, database)

    with app.app_context():
        try:
            if upgrade:
                command.upgrade(config, "base:head", sql=True)
            else:
                command.downgrade(config, "head:base", sql=True)
        finally:
            database.engine.dispose()

    assert {
        logger: (logger.disabled, logger.level, logger.propagate, tuple(logger.handlers), tuple(logger.filters))
        for logger in loggers
    } == routes
    sql = output.getvalue()
    assert "SELECT current_schema()" not in sql
    if dialect == "mysql":
        assert "LANGUAGE plpgsql" not in sql
        assert "DO $$" not in sql
        assert "IS DISTINCT FROM" not in sql
        assert " IN ACCESS EXCLUSIVE MODE" not in sql
        assert "SIGNAL SQLSTATE '45000'" in sql
        if upgrade:
            for trigger in (
                "native_attempts_immutable_update",
                "native_attempts_immutable_delete",
                "native_outcomes_immutable_update",
                "native_outcomes_immutable_delete",
                "native_payload_objects_immutable_update",
                "native_continuations_immutable_delete",
                "native_effect_dispatch_claims_immutable_update",
                "native_read_owner_immutable",
                "code_physical_monotone_update",
                "code_physical_monotone_delete",
            ):
                assert f"CREATE TRIGGER {trigger}" in sql
        else:
            assert "LOCK TABLES dify_builder_native_effect_dispatch_claims WRITE" in sql
            assert "LOCK TABLES dify_builder_native_code_physical_operations WRITE" in sql
            assert "CALL builder_downgrade_guard()" in sql
            assert "UNLOCK TABLES" in sql
    else:
        verb = "CREATE" if upgrade else "DROP"
        for function in (
            "builder_native_immutable_ledger",
            "builder_native_immutable_read_owner",
            "builder_code_physical_monotone",
        ):
            assert f"{verb} FUNCTION {function}()" in sql
    if upgrade and dialect == "postgresql":
        assert "CREATE TRIGGER native_ledger_immutable" in sql
        assert "CREATE TRIGGER native_read_owner_immutable" in sql
        assert "CREATE TRIGGER code_physical_monotone" in sql
    if not upgrade:
        for reason in (
            "native continuation recovery data must be retained",
            "native invocation read owner evidence must be retained",
            "native dispatch claim evidence must be retained",
            "Code physical evidence must be retained",
            "terminate native waits before downgrade",
        ):
            assert reason in sql
        if dialect == "postgresql":
            assert "LOCK TABLE dify_builder_native_effect_dispatch_claims IN ACCESS EXCLUSIVE MODE" in sql
            assert "LOCK TABLE dify_builder_native_code_physical_operations IN ACCESS EXCLUSIVE MODE" in sql

"""Native draft refresh persists portable SQL and fingerprints the committed rotation."""

import pytest
from sqlalchemy import Update, event
from sqlalchemy.dialects import registry
from sqlalchemy.orm import ORMExecuteState, Session

from configs.middleware import DatabaseConfig
from tests.unit_tests.services.test_draft_tool_admission import (
    NativeOAuthCase,
)
from tests.unit_tests.services.test_draft_tool_admission import (
    draft_tools as installed_draft_tools,
)
from tests.unit_tests.services.test_draft_tool_admission import (
    native_draft as installed_native_draft,
)
from tests.unit_tests.services.test_draft_tool_admission import (
    native_draft_oauth as installed_native_draft_oauth,
)

draft_tools = installed_draft_tools
native_draft = installed_native_draft
native_draft_oauth = installed_native_draft_oauth


@pytest.mark.parametrize("backend", ["postgresql", "mysql", "oceanbase", "seekdb"])
def test_native_draft_refresh_uses_supported_database_update(
    native_draft_oauth: NativeOAuthCase,
    backend: str,
) -> None:
    statements: list[Update] = []

    def observe_update(state: ORMExecuteState) -> None:
        if isinstance(state.statement, Update):
            statements.append(state.statement)

    event.listen(Session, "do_orm_execute", observe_update)
    try:
        runtime = native_draft_oauth.resolve()
    finally:
        event.remove(Session, "do_orm_execute", observe_update)
    assert runtime.runtime.credentials["access_token"] == "synthetic-new-access"
    assert len(statements) == 1
    config = DatabaseConfig.model_validate({"DB_TYPE": backend})
    dialect = registry.load(config.SQLALCHEMY_DATABASE_URI_SCHEME.replace("+", "."))()
    compiled = str(statements[0].compile(dialect=dialect)).upper()
    assert " RETURNING " not in compiled
    assert "EXPIRES_AT" in compiled
    assert "ENCRYPTED_CREDENTIALS" in compiled

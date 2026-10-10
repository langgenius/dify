from collections.abc import Iterator

import pytest
from click.testing import CliRunner

from commands import rbac
from tests.unit_tests.rbac_fakes import RBACDomain


@pytest.mark.parametrize("workers", [1, 2])
def test_member_migration_uses_shared_remote_adapter_without_write_sessions(
    monkeypatch: pytest.MonkeyPatch, rbac_domain: RBACDomain, workers: int
) -> None:
    def batches(
        tenant_id: str | None, *, db_batch_size: int, api_batch_size: int
    ) -> Iterator[tuple[str, str, list[tuple[str, str]]]]:
        assert tenant_id is None
        assert db_batch_size > 0
        assert api_batch_size > 0
        yield "workspace", "owner", [("first", "editor"), ("second", "normal")]

    def unexpected_session() -> None:
        raise AssertionError("A remote role replacement must not open a database session")

    monkeypatch.setattr(rbac, "_iter_tenant_member_batches", batches)
    monkeypatch.setattr(
        rbac, "_resolve_builtin_role_ids", lambda *_args: {"editor": "role-editor", "normal": "role-normal"}
    )
    monkeypatch.setattr(rbac.RBACService.MemberRoles, "batch_get", lambda **_kwargs: [])
    monkeypatch.setattr(rbac.session_factory, "create_session", unexpected_session)
    rbac_domain.transport.response = {"account_id": "member", "roles": []}

    result = CliRunner().invoke(rbac.migrate_member_roles_to_rbac, ["--workers", str(workers)])

    assert result.exit_code == 0, result.output
    sent = rbac_domain.transport.requests
    assert len(sent) == 2
    for request in sent:
        assert (request.method, request.endpoint) == ("PUT", "/rbac/members/rbac-roles")
        assert (request.tenant_id, request.account_id) == ("workspace", "owner")
        assert request.params is not None
        expected_role = "role-editor" if request.params["account_id"] == "first" else "role-normal"
        assert request.json == {"role_ids": [expected_role]}
    assert {request.params["account_id"] for request in sent if request.params} == {"first", "second"}

import pytest

from services.enterprise.base import EnterpriseRequest
from services.enterprise.rbac_service import RBACService
from tests.unit_tests.rbac_fakes import RBACTransport


def test_membership_gateway_sends_identity_language_and_assignment(monkeypatch: pytest.MonkeyPatch) -> None:
    transport = RBACTransport(response={"account_id": "member", "roles": []})
    monkeypatch.setattr(EnterpriseRequest, "send_inner_rbac_request", transport.send)
    result = RBACService.MemberRoles.replace("workspace", "actor", "member", ["role"], language="zh")
    assert result.account_id == "member"
    sent = transport.only_request
    assert (sent.method, sent.endpoint) == ("PUT", "/rbac/members/rbac-roles")
    assert (sent.tenant_id, sent.account_id) == ("workspace", "actor")
    assert sent.params == {"account_id": "member", "language": "zh"}
    assert sent.json == {"role_ids": ["role"]}


def test_permission_gateway_excludes_absent_resource_selectors(monkeypatch: pytest.MonkeyPatch) -> None:
    transport = RBACTransport(response={})
    monkeypatch.setattr(EnterpriseRequest, "send_inner_rbac_request", transport.send)
    RBACService.MyPermissions.get("workspace", "actor", app_id=None, dataset_id=None, agent_id="agent", language=None)
    assert transport.only_request.endpoint == "/rbac/my-permissions"
    assert transport.only_request.params == {"agent_id": "agent"}

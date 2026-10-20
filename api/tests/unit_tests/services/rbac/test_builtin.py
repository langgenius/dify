"""Built-in role projections keep the supported permission vocabulary."""

from services.rbac import builtin


class TestBuiltinAgentKeys:
    def test_builtin_workspace_keys_no_longer_carry_agent_manage(self) -> None:
        for keys in (
            builtin._BUILTIN_WORKSPACE_OWNER_KEYS,
            builtin._BUILTIN_WORKSPACE_ADMIN_KEYS,
            builtin._BUILTIN_WORKSPACE_EDITOR_KEYS,
            builtin._BUILTIN_WORKSPACE_NORMAL_KEYS,
            builtin._BUILTIN_WORKSPACE_DATASET_OPERATOR_KEYS,
        ):
            assert "agent.manage" not in keys
            assert {"agent.acl.preview", "agent.acl.access_point_view"} <= set(keys)

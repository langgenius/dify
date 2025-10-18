"""
Unit tests for SystemVariable passthrough functionality
"""

from core.workflow.enums import SystemVariableKey
from core.workflow.system_variable import SystemVariable


class TestSystemVariablePassthrough:
    """Test SystemVariable passthrough functionality"""

    def test_system_variable_key_passthrough_exists(self):
        """Test that PASSTHROUGH key exists in SystemVariableKey enum"""
        assert hasattr(SystemVariableKey, "PASSTHROUGH")
        assert SystemVariableKey.PASSTHROUGH == "passthrough"

    def test_system_variable_with_passthrough(self):
        """Test SystemVariable with passthrough parameter"""
        system_var = SystemVariable(user_id="test_user", files=[], passthrough="test_passthrough_data")

        assert system_var.passthrough == "test_passthrough_data"

    def test_system_variable_without_passthrough(self):
        """Test SystemVariable without passthrough parameter"""
        system_var = SystemVariable(user_id="test_user", files=[])

        assert system_var.passthrough is None

    def test_system_variable_to_dict_with_passthrough(self):
        """Test SystemVariable to_dict method with passthrough"""
        system_var = SystemVariable(user_id="test_user", files=[], passthrough="test_passthrough_data")

        var_dict = system_var.to_dict()
        assert SystemVariableKey.PASSTHROUGH in var_dict
        assert var_dict[SystemVariableKey.PASSTHROUGH] == "test_passthrough_data"

    def test_system_variable_to_dict_without_passthrough(self):
        """Test SystemVariable to_dict method without passthrough"""
        system_var = SystemVariable(user_id="test_user", files=[])

        var_dict = system_var.to_dict()
        assert SystemVariableKey.PASSTHROUGH not in var_dict

    def test_system_variable_passthrough_none(self):
        """Test SystemVariable with passthrough explicitly set to None"""
        system_var = SystemVariable(user_id="test_user", files=[], passthrough=None)

        assert system_var.passthrough is None
        var_dict = system_var.to_dict()
        assert SystemVariableKey.PASSTHROUGH not in var_dict

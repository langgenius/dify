import dataclasses
import secrets

from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.nodes import NodeType
from factories.variable_factory import build_segment
from models.workflow import WorkflowDraftVariable
from services.workflow_draft_variable_service import _DraftVariableBuilder


class TestDraftVariableBuilder:
    def _get_test_app_id(self):
        suffix = secrets.token_hex(6)
        return f"test_app_id_{suffix}"

    def test_get_variables(self):
        test_app_id = self._get_test_app_id()
        builder = _DraftVariableBuilder(app_id=test_app_id)
        variables = [
            WorkflowDraftVariable.new_node_variable(
                app_id=test_app_id,
                node_id="test_node_1",
                name="test_var_1",
                value=build_segment("test_value_1"),
                visible=True,
            ),
            WorkflowDraftVariable.new_sys_variable(
                app_id=test_app_id,
                name="test_sys_var",
                value=build_segment("test_sys_value"),
            ),
            WorkflowDraftVariable.new_conversation_variable(
                app_id=test_app_id,
                name="test_conv_var",
                value=build_segment("test_conv_value"),
            ),
        ]
        builder._draft_vars = variables
        assert builder.get_variables() == variables

    def test__should_variable_be_visible(self):
        assert _DraftVariableBuilder._should_variable_be_visible(NodeType.IF_ELSE, "123_456", "output") == False
        assert _DraftVariableBuilder._should_variable_be_visible(NodeType.START, "123", "output") == True

    def test__normalize_variable_for_start_node(self):
        @dataclasses.dataclass(frozen=True)
        class TestCase:
            name: str
            input_node_id: str
            input_name: str
            expected_node_id: str
            expected_name: str

        _NODE_ID = "1747228642872"
        cases = [
            TestCase(
                name="name with `sys.` prefix should return the system node_id",
                input_node_id=_NODE_ID,
                input_name="sys.workflow_id",
                expected_node_id=SYSTEM_VARIABLE_NODE_ID,
                expected_name="workflow_id",
            ),
            TestCase(
                name="name without `sys.` prefix should return the original input node_id",
                input_node_id=_NODE_ID,
                input_name="start_input",
                expected_node_id=_NODE_ID,
                expected_name="start_input",
            ),
            TestCase(
                name="dummy_variable should return the original input node_id",
                input_node_id=_NODE_ID,
                input_name="__dummy__",
                expected_node_id=_NODE_ID,
                expected_name="__dummy__",
            ),
        ]
        for idx, c in enumerate(cases, 1):
            fail_msg = f"Test case {c.name} failed, index={idx}"
            node_id, name = _DraftVariableBuilder._normalize_variable_for_start_node(c.input_node_id, c.input_name)
            assert node_id == c.expected_node_id, fail_msg
            assert name == c.expected_name, fail_msg

import dataclasses
import secrets
from unittest import mock

from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.nodes import NodeType
from services.workflow_draft_variable_service import DraftVariableSaver


class TestDraftVariableSaver:
    def _get_test_app_id(self):
        suffix = secrets.token_hex(6)
        return f"test_app_id_{suffix}"

    def test__should_variable_be_visible(self):
        mock_session = mock.MagicMock(spec=Session)
        test_app_id = self._get_test_app_id()
        saver = DraftVariableSaver(
            session=mock_session,
            app_id=test_app_id,
            node_id="test_node_id",
            node_type=NodeType.START,
            invoke_from=InvokeFrom.DEBUGGER,
        )
        assert saver._should_variable_be_visible("123_456", NodeType.IF_ELSE, "output") == False
        assert saver._should_variable_be_visible("123", NodeType.START, "output") == True

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

        mock_session = mock.MagicMock(spec=Session)
        test_app_id = self._get_test_app_id()
        saver = DraftVariableSaver(
            session=mock_session,
            app_id=test_app_id,
            node_id=_NODE_ID,
            node_type=NodeType.START,
            invoke_from=InvokeFrom.DEBUGGER,
        )
        for idx, c in enumerate(cases, 1):
            fail_msg = f"Test case {c.name} failed, index={idx}"
            node_id, name = saver._normalize_variable_for_start_node(c.input_name)
            assert node_id == c.expected_node_id, fail_msg
            assert name == c.expected_name, fail_msg

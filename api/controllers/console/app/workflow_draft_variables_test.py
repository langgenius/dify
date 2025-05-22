import datetime
import uuid
from collections import OrderedDict
from typing import NamedTuple

from flask_restful import marshal

from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from factories.variable_factory import build_segment
from models.workflow import WorkflowDraftVariable
from services.workflow_draft_variable_service import WorkflowDraftVariableList

from .workflow_draft_variable import (
    _WORKFLOW_DRAFT_VARIABLE_FIELDS,
    _WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS,
    _WORKFLOW_DRAFT_VARIABLE_LIST_WITHOUT_VALUE_FIELDS,
    _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS,
)

_TEST_APP_ID = "test_app_id"


class TestWorkflowDraftVariableFields:
    def test_conversation_variable(self):
        conv_var = WorkflowDraftVariable.new_conversation_variable(
            app_id=_TEST_APP_ID, name="conv_var", value=build_segment(1)
        )

        conv_var.id = str(uuid.uuid4())
        conv_var.visible = True

        expected_without_value = OrderedDict(
            {
                "id": str(conv_var.id),
                "type": conv_var.get_variable_type().value,
                "name": "conv_var",
                "description": "",
                "selector": [CONVERSATION_VARIABLE_NODE_ID, "conv_var"],
                "value_type": "number",
                "edited": False,
                "visible": True,
            }
        )

        assert marshal(conv_var, _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS) == expected_without_value
        expected_with_value = expected_without_value.copy()
        expected_with_value["value"] = 1
        assert marshal(conv_var, _WORKFLOW_DRAFT_VARIABLE_FIELDS) == expected_with_value

    def test_create_sys_variable(self):
        sys_var = WorkflowDraftVariable.new_sys_variable(
            app_id=_TEST_APP_ID,
            name="sys_var",
            value=build_segment("a"),
            editable=True,
        )

        sys_var.id = str(uuid.uuid4())
        sys_var.last_edited_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        sys_var.visible = True

        expected_without_value = OrderedDict(
            {
                "id": str(sys_var.id),
                "type": sys_var.get_variable_type().value,
                "name": "sys_var",
                "description": "",
                "selector": [SYSTEM_VARIABLE_NODE_ID, "sys_var"],
                "value_type": "string",
                "edited": True,
                "visible": True,
            }
        )
        assert marshal(sys_var, _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS) == expected_without_value
        expected_with_value = expected_without_value.copy()
        expected_with_value["value"] = "a"
        assert marshal(sys_var, _WORKFLOW_DRAFT_VARIABLE_FIELDS) == expected_with_value

    def test_node_variable(self):
        node_var = WorkflowDraftVariable.new_node_variable(
            app_id=_TEST_APP_ID,
            node_id="test_node",
            name="node_var",
            value=build_segment([1, "a"]),
            visible=False,
        )

        node_var.id = str(uuid.uuid4())
        node_var.last_edited_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)

        expected_without_value = OrderedDict(
            {
                "id": str(node_var.id),
                "type": node_var.get_variable_type().value,
                "name": "node_var",
                "description": "",
                "selector": ["test_node", "node_var"],
                "value_type": "array[any]",
                "edited": True,
                "visible": False,
            }
        )

        assert marshal(node_var, _WORKFLOW_DRAFT_VARIABLE_WITHOUT_VALUE_FIELDS) == expected_without_value
        expected_with_value = expected_without_value.copy()
        expected_with_value["value"] = [1, "a"]
        assert marshal(node_var, _WORKFLOW_DRAFT_VARIABLE_FIELDS) == expected_with_value


class TestWorkflowDraftVariableList:
    def test_workflow_draft_variable_list(self):
        class TestCase(NamedTuple):
            name: str
            var_list: WorkflowDraftVariableList
            expected: dict

        node_var = WorkflowDraftVariable.new_node_variable(
            app_id=_TEST_APP_ID,
            node_id="test_node",
            name="test_var",
            value=build_segment("a"),
            visible=True,
        )
        node_var.id = str(uuid.uuid4())
        node_var_dict = OrderedDict(
            {
                "id": str(node_var.id),
                "type": node_var.get_variable_type().value,
                "name": "test_var",
                "description": "",
                "selector": ["test_node", "test_var"],
                "value_type": "string",
                "edited": False,
                "visible": True,
            }
        )

        cases = [
            TestCase(
                name="empty variable list",
                var_list=WorkflowDraftVariableList(variables=[]),
                expected=OrderedDict(
                    {
                        "items": [],
                        "total": None,
                    }
                ),
            ),
            TestCase(
                name="empty variable list with total",
                var_list=WorkflowDraftVariableList(variables=[], total=10),
                expected=OrderedDict(
                    {
                        "items": [],
                        "total": 10,
                    }
                ),
            ),
            TestCase(
                name="non-empty variable list",
                var_list=WorkflowDraftVariableList(variables=[node_var], total=None),
                expected=OrderedDict(
                    {
                        "items": [node_var_dict],
                        "total": None,
                    }
                ),
            ),
            TestCase(
                name="non-empty variable list with total",
                var_list=WorkflowDraftVariableList(variables=[node_var], total=10),
                expected=OrderedDict(
                    {
                        "items": [node_var_dict],
                        "total": 10,
                    }
                ),
            ),
        ]

        for idx, case in enumerate(cases, 1):
            assert marshal(case.var_list, _WORKFLOW_DRAFT_VARIABLE_LIST_WITHOUT_VALUE_FIELDS) == case.expected, (
                f"Test case {idx} failed, {case.name=}"
            )


def test_workflow_node_variables_fields():
    conv_var = WorkflowDraftVariable.new_conversation_variable(
        app_id=_TEST_APP_ID, name="conv_var", value=build_segment(1)
    )
    resp = marshal(WorkflowDraftVariableList(variables=[conv_var]), _WORKFLOW_DRAFT_VARIABLE_LIST_FIELDS)
    assert isinstance(resp, dict)
    assert len(resp["items"]) == 1
    item_dict = resp["items"][0]
    assert item_dict["name"] == "conv_var"
    assert item_dict["value"] == 1

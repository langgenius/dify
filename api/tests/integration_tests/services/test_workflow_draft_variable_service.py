import unittest
import uuid

import pytest
from sqlalchemy.orm import Session

from factories.variable_factory import build_segment
from models import db
from models.workflow import WorkflowDraftVariable
from services.workflow_draft_variable_service import WorkflowDraftVariableService


@pytest.mark.usefixtures("flask_req_ctx")
class TestWorkflowDraftVariableService(unittest.TestCase):
    _test_app_id: str
    _session: Session
    _node2_id = "test_node_2"

    def setUp(self):
        self._test_app_id = str(uuid.uuid4())
        self._session: Session = db.session
        sys_var = WorkflowDraftVariable.create_sys_variable(
            app_id=self._test_app_id,
            name="sys_var",
            value=build_segment("sys_value"),
        )
        conv_var = WorkflowDraftVariable.create_conversation_variable(
            app_id=self._test_app_id,
            name="conv_var",
            value=build_segment("conv_value"),
        )
        node2_vars = [
            WorkflowDraftVariable.create_node_variable(
                app_id=self._test_app_id,
                node_id=self._node2_id,
                name="int_var",
                value=build_segment(1),
                visible=False,
            ),
            WorkflowDraftVariable.create_node_variable(
                app_id=self._test_app_id,
                node_id=self._node2_id,
                name="str_var",
                value=build_segment("str_value"),
                visible=True,
            ),
        ]
        node1_var = WorkflowDraftVariable.create_node_variable(
            app_id=self._test_app_id,
            node_id="node_1",
            name="str_var",
            value=build_segment("str_value"),
            visible=True,
        )
        _variables = list(node2_vars)
        _variables.extend(
            [
                node1_var,
                sys_var,
                conv_var,
            ]
        )

        db.session.add_all(_variables)
        db.session.flush()
        self._variable_ids = [v.id for v in _variables]
        self._node1_str_var_id = node1_var.id
        self._sys_var_id = sys_var.id
        self._conv_var_id = conv_var.id
        self._node2_var_ids = [v.id for v in node2_vars]

    def _get_test_srv(self) -> WorkflowDraftVariableService:
        return WorkflowDraftVariableService(session=self._session)

    def tearDown(self):
        self._session.rollback()

    def test_list_variables(self):
        srv = self._get_test_srv()
        var_list = srv.list_variables_without_values(self._test_app_id, page=1, limit=2)
        assert var_list.total == 5
        assert len(var_list.variables) == 2
        page1_var_ids = {v.id for v in var_list.variables}
        assert page1_var_ids.issubset(self._variable_ids)

        var_list_2 = srv.list_variables_without_values(self._test_app_id, page=2, limit=2)
        assert var_list_2.total is None
        assert len(var_list_2.variables) == 2
        page2_var_ids = {v.id for v in var_list_2.variables}
        assert page2_var_ids.isdisjoint(page1_var_ids)
        assert page2_var_ids.issubset(self._variable_ids)

    def test_get_node_variable(self):
        srv = self._get_test_srv()
        node_var = srv.get_node_variable(self._test_app_id, "node_1", "str_var")
        assert node_var.id == self._node1_str_var_id
        assert node_var.name == "str_var"
        assert node_var.get_value() == build_segment("str_value")

    def test_get_system_variable(self):
        srv = self._get_test_srv()
        sys_var = srv.get_system_variable(self._test_app_id, "sys_var")
        assert sys_var.id == self._sys_var_id
        assert sys_var.name == "sys_var"
        assert sys_var.get_value() == build_segment("sys_value")

    def test_get_conversation_variable(self):
        srv = self._get_test_srv()
        conv_var = srv.get_conversation_variable(self._test_app_id, "conv_var")
        assert conv_var.id == self._conv_var_id
        assert conv_var.name == "conv_var"
        assert conv_var.get_value() == build_segment("conv_value")

    def test_delete_node_variables(self):
        srv = self._get_test_srv()
        srv.delete_node_variables(self._test_app_id, self._node2_id)
        node2_var_count = (
            self._session.query(WorkflowDraftVariable)
            .where(
                WorkflowDraftVariable.app_id == self._test_app_id,
                WorkflowDraftVariable.node_id == self._node2_id,
            )
            .count()
        )
        assert node2_var_count == 0

    def test_delete_variable(self):
        srv = self._get_test_srv()
        node_1_var = (
            self._session.query(WorkflowDraftVariable).where(WorkflowDraftVariable.id == self._node1_str_var_id).one()
        )
        srv.delete_variable(node_1_var)
        exists = bool(
            self._session.query(WorkflowDraftVariable).where(WorkflowDraftVariable.id == self._node1_str_var_id).first()
        )
        assert exists is False

    def test__list_node_variables(self):
        srv = self._get_test_srv()
        node_vars = srv._list_node_variables(self._test_app_id, self._node2_id)
        assert len(node_vars) == 2
        assert {v.id for v in node_vars} == set(self._node2_var_ids)

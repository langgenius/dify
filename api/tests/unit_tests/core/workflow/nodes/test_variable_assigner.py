from unittest import mock
from uuid import uuid4

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.segments import ArrayStringVariable, StringVariable
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariable
from core.workflow.nodes.base_node import UserFrom
from core.workflow.nodes.variable_assigner import VariableAssignerNode, WriteMode

DEFAULT_NODE_ID = 'node_id'


def test_overwrite_string_variable():
    conversation_variable = StringVariable(
        id=str(uuid4()),
        name='test_conversation_variable',
        value='the first value',
    )

    input_variable = StringVariable(
        id=str(uuid4()),
        name='test_string_variable',
        value='the second value',
    )

    node = VariableAssignerNode(
        tenant_id='tenant_id',
        app_id='app_id',
        workflow_id='workflow_id',
        user_id='user_id',
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        config={
            'id': 'node_id',
            'data': {
                'assigned_variable_selector': ['conversation', conversation_variable.name],
                'write_mode': WriteMode.OVER_WRITE.value,
                'input_variable_selector': [DEFAULT_NODE_ID, input_variable.name],
            },
        },
    )

    variable_pool = VariablePool(
        system_variables={SystemVariable.CONVERSATION_ID: 'conversation_id'},
        user_inputs={},
        environment_variables=[],
        conversation_variables=[conversation_variable],
    )
    variable_pool.add(
        [DEFAULT_NODE_ID, input_variable.name],
        input_variable,
    )

    with mock.patch('core.workflow.nodes.variable_assigner.update_conversation_variable') as mock_run:
        node.run(variable_pool)
        mock_run.assert_called_once()

    got = variable_pool.get(['conversation', conversation_variable.name])
    assert got is not None
    assert got.value == 'the second value'
    assert got.to_object() == 'the second value'


def test_append_variable_to_array():
    conversation_variable = ArrayStringVariable(
        id=str(uuid4()),
        name='test_conversation_variable',
        value=['the first value'],
    )

    input_variable = StringVariable(
        id=str(uuid4()),
        name='test_string_variable',
        value='the second value',
    )

    node = VariableAssignerNode(
        tenant_id='tenant_id',
        app_id='app_id',
        workflow_id='workflow_id',
        user_id='user_id',
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        config={
            'id': 'node_id',
            'data': {
                'assigned_variable_selector': ['conversation', conversation_variable.name],
                'write_mode': WriteMode.APPEND.value,
                'input_variable_selector': [DEFAULT_NODE_ID, input_variable.name],
            },
        },
    )

    variable_pool = VariablePool(
        system_variables={SystemVariable.CONVERSATION_ID: 'conversation_id'},
        user_inputs={},
        environment_variables=[],
        conversation_variables=[conversation_variable],
    )
    variable_pool.add(
        [DEFAULT_NODE_ID, input_variable.name],
        input_variable,
    )

    with mock.patch('core.workflow.nodes.variable_assigner.update_conversation_variable') as mock_run:
        node.run(variable_pool)
        mock_run.assert_called_once()

    got = variable_pool.get(['conversation', conversation_variable.name])
    assert got is not None
    assert got.to_object() == ['the first value', 'the second value']


def test_clear_array():
    conversation_variable = ArrayStringVariable(
        id=str(uuid4()),
        name='test_conversation_variable',
        value=['the first value'],
    )

    node = VariableAssignerNode(
        tenant_id='tenant_id',
        app_id='app_id',
        workflow_id='workflow_id',
        user_id='user_id',
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        config={
            'id': 'node_id',
            'data': {
                'assigned_variable_selector': ['conversation', conversation_variable.name],
                'write_mode': WriteMode.CLEAR.value,
                'input_variable_selector': [],
            },
        },
    )

    variable_pool = VariablePool(
        system_variables={SystemVariable.CONVERSATION_ID: 'conversation_id'},
        user_inputs={},
        environment_variables=[],
        conversation_variables=[conversation_variable],
    )

    node.run(variable_pool)

    got = variable_pool.get(['conversation', conversation_variable.name])
    assert got is not None
    assert got.to_object() == []

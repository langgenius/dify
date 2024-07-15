from unittest import mock

import contexts
from core.app.variables import FloatVariable, IntegerVariable, SecretVariable, TextVariable
from models.workflow import Workflow


def test_environment_variables():
    # Create a mock user
    mock_user = mock.MagicMock()
    mock_user.is_authenticated = True
    mock_user.id = 1
    mock_user.username = 'testuser'
    mock_user.current_tenant_id = 'tenant_id'

    contexts.current_user.set(mock_user)

    # Create a Workflow instance
    workflow = Workflow()

    # Create some EnvironmentVariable instances
    variable1 = TextVariable.model_validate({'name': 'var1', 'value': 'value1'})
    variable2 = IntegerVariable.model_validate({'name': 'var2', 'value': 123})
    variable3 = SecretVariable.model_validate({'name': 'var3', 'value': 'secret'})
    variable4 = FloatVariable.model_validate({'name': 'var4', 'value': 3.14})

    with (
        mock.patch('core.helper.encrypter.encrypt_token', return_value='encrypted_token'),
        mock.patch('core.helper.encrypter.decrypt_token', return_value='secret'),
    ):
        # Set the environment_variables property of the Workflow instance
        workflow.environment_variables = [variable1, variable2, variable3, variable4]

        # Get the environment_variables property and assert its value
        assert workflow.environment_variables == [variable1, variable2, variable3, variable4]


def test_to_dict():
    # Create a mock user
    mock_user = mock.MagicMock()
    mock_user.is_authenticated = True
    mock_user.id = 1
    mock_user.username = 'testuser'
    mock_user.current_tenant_id = 'tenant_id'

    contexts.current_user.set(mock_user)

    # Create a Workflow instance
    workflow = Workflow(
        graph='{}',
        features='{}',
    )

    # Create some EnvironmentVariable instances

    with (
        mock.patch('core.helper.encrypter.encrypt_token', return_value='encrypted_token'),
        mock.patch('core.helper.encrypter.decrypt_token', return_value='secret'),
    ):
        # Set the environment_variables property of the Workflow instance
        workflow.environment_variables = [
            SecretVariable.model_validate({'name': 'secret', 'value': 'secret'}),
            TextVariable.model_validate({'name': 'text', 'value': 'text'}),
        ]

        workflow_dict = workflow.to_dict()
        assert workflow_dict['environment_variables'][0]['value'] == ''
        assert workflow_dict['environment_variables'][1]['value'] == 'text'

        workflow_dict = workflow.to_dict(include_secret=True)
        assert workflow_dict['environment_variables'][0]['value'] == 'secret'
        assert workflow_dict['environment_variables'][1]['value'] == 'text'

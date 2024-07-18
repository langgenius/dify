from unittest import mock

import contexts
from core.app.segments import FloatVariable, IntegerVariable, SecretVariable, StringVariable
from models.workflow import Workflow


def test_environment_variables():
    contexts.tenant_id.set('tenant_id')

    # Create a Workflow instance
    workflow = Workflow()

    # Create some EnvironmentVariable instances
    variable1 = StringVariable.model_validate({'name': 'var1', 'value': 'value1'})
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
    contexts.tenant_id.set('tenant_id')

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
            StringVariable.model_validate({'name': 'text', 'value': 'text'}),
        ]

        workflow_dict = workflow.to_dict()
        assert workflow_dict['environment_variables'][0]['value'] == ''
        assert workflow_dict['environment_variables'][1]['value'] == 'text'

        workflow_dict = workflow.to_dict(include_secret=True)
        assert workflow_dict['environment_variables'][0]['value'] == 'secret'
        assert workflow_dict['environment_variables'][1]['value'] == 'text'

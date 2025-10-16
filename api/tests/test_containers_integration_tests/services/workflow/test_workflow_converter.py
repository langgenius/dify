import json
from unittest.mock import patch

import pytest
from faker import Faker

from core.app.app_config.entities import (
    DatasetEntity,
    DatasetRetrieveConfigEntity,
    ExternalDataVariableEntity,
    ModelConfigEntity,
    PromptTemplateEntity,
    VariableEntity,
    VariableEntityType,
)
from core.model_runtime.entities.llm_entities import LLMMode
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from models import Account, Tenant
from models.api_based_extension import APIBasedExtension
from models.model import App, AppMode, AppModelConfig
from models.workflow import Workflow
from services.workflow.workflow_converter import WorkflowConverter


class TestWorkflowConverter:
    """Integration tests for WorkflowConverter using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.workflow.workflow_converter.encrypter") as mock_encrypter,
            patch("services.workflow.workflow_converter.SimplePromptTransform") as mock_prompt_transform,
            patch("services.workflow.workflow_converter.AgentChatAppConfigManager") as mock_agent_chat_config_manager,
            patch("services.workflow.workflow_converter.ChatAppConfigManager") as mock_chat_config_manager,
            patch("services.workflow.workflow_converter.CompletionAppConfigManager") as mock_completion_config_manager,
        ):
            # Setup default mock returns
            mock_encrypter.decrypt_token.return_value = "decrypted_api_key"
            mock_prompt_transform.return_value.get_prompt_template.return_value = {
                "prompt_template": PromptTemplateParser(template="You are a helpful assistant {{text_input}}"),
                "prompt_rules": {"human_prefix": "Human", "assistant_prefix": "Assistant"},
            }
            mock_agent_chat_config_manager.get_app_config.return_value = self._create_mock_app_config()
            mock_chat_config_manager.get_app_config.return_value = self._create_mock_app_config()
            mock_completion_config_manager.get_app_config.return_value = self._create_mock_app_config()

            yield {
                "encrypter": mock_encrypter,
                "prompt_transform": mock_prompt_transform,
                "agent_chat_config_manager": mock_agent_chat_config_manager,
                "chat_config_manager": mock_chat_config_manager,
                "completion_config_manager": mock_completion_config_manager,
            }

    def _create_mock_app_config(self):
        """Helper method to create a mock app config."""
        mock_config = type("obj", (object,), {})()
        mock_config.variables = [
            VariableEntity(
                variable="text_input",
                label="Text Input",
                type=VariableEntityType.TEXT_INPUT,
            )
        ]
        mock_config.model = ModelConfigEntity(
            provider="openai",
            model="gpt-4",
            mode=LLMMode.CHAT,
            parameters={},
            stop=[],
        )
        mock_config.prompt_template = PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
            simple_prompt_template="You are a helpful assistant {{text_input}}",
        )
        mock_config.dataset = None
        mock_config.external_data_variables = []
        mock_config.additional_features = type("obj", (object,), {"file_upload": None})()
        mock_config.app_model_config_dict = {}
        return mock_config

    def _create_test_account_and_tenant(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test account and tenant for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (account, tenant) - Created account and tenant instances
        """
        fake = Faker()

        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )

        from extensions.ext_database import db

        db.session.add(account)
        db.session.commit()

        # Create tenant for the account
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
        from models.account import TenantAccountJoin, TenantAccountRole

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        # Set current tenant for account
        account.current_tenant = tenant

        return account, tenant

    def _create_test_app(self, db_session_with_containers, mock_external_service_dependencies, tenant, account):
        """
        Helper method to create a test app for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            tenant: Tenant instance
            account: Account instance

        Returns:
            App: Created app instance
        """
        fake = Faker()

        # Create app
        app = App(
            tenant_id=tenant.id,
            name=fake.company(),
            mode=AppMode.CHAT,
            icon_type="emoji",
            icon="🤖",
            icon_background="#FF6B6B",
            enable_site=True,
            enable_api=True,
            api_rpm=100,
            api_rph=10,
            is_demo=False,
            is_public=False,
            created_by=account.id,
            updated_by=account.id,
        )

        from extensions.ext_database import db

        db.session.add(app)
        db.session.commit()

        # Create app model config
        app_model_config = AppModelConfig(
            app_id=app.id,
            provider="openai",
            model="gpt-4",
            configs={},
            created_by=account.id,
            updated_by=account.id,
        )
        db.session.add(app_model_config)
        db.session.commit()

        # Link app model config to app
        app.app_model_config_id = app_model_config.id
        db.session.commit()

        return app

    def test_convert_to_workflow_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful conversion of app to workflow.

        This test verifies:
        - Proper app to workflow conversion
        - Correct database state after conversion
        - Proper relationship establishment
        - Workflow creation with correct configuration
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant, account)

        # Act: Execute the conversion
        workflow_converter = WorkflowConverter()
        new_app = workflow_converter.convert_to_workflow(
            app_model=app,
            account=account,
            name="Test Workflow App",
            icon_type="emoji",
            icon="🚀",
            icon_background="#4CAF50",
        )

        # Assert: Verify the expected outcomes
        assert new_app is not None
        assert new_app.name == "Test Workflow App"
        assert new_app.mode == AppMode.ADVANCED_CHAT
        assert new_app.icon_type == "emoji"
        assert new_app.icon == "🚀"
        assert new_app.icon_background == "#4CAF50"
        assert new_app.tenant_id == app.tenant_id
        assert new_app.created_by == account.id

        # Verify database state
        from extensions.ext_database import db

        db.session.refresh(new_app)
        assert new_app.id is not None

        # Verify workflow was created
        workflow = db.session.query(Workflow).where(Workflow.app_id == new_app.id).first()
        assert workflow is not None
        assert workflow.tenant_id == app.tenant_id
        assert workflow.type == "chat"

    def test_convert_to_workflow_without_app_model_config_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error handling when app model config is missing.

        This test verifies:
        - Proper error handling for missing app model config
        - Correct exception type and message
        - Database state remains unchanged
        """
        # Arrange: Create test data without app model config
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        app = App(
            tenant_id=tenant.id,
            name=fake.company(),
            mode=AppMode.CHAT,
            icon_type="emoji",
            icon="🤖",
            icon_background="#FF6B6B",
            enable_site=True,
            enable_api=True,
            api_rpm=100,
            api_rph=10,
            is_demo=False,
            is_public=False,
            created_by=account.id,
            updated_by=account.id,
        )

        from extensions.ext_database import db

        db.session.add(app)
        db.session.commit()

        # Act & Assert: Verify proper error handling
        workflow_converter = WorkflowConverter()

        # Check initial state
        initial_workflow_count = db.session.query(Workflow).count()

        with pytest.raises(ValueError, match="App model config is required"):
            workflow_converter.convert_to_workflow(
                app_model=app,
                account=account,
                name="Test Workflow App",
                icon_type="emoji",
                icon="🚀",
                icon_background="#4CAF50",
            )

        # Verify database state remains unchanged
        # The workflow creation happens in convert_app_model_config_to_workflow
        # which is called before the app_model_config check, so we need to clean up
        db.session.rollback()
        final_workflow_count = db.session.query(Workflow).count()
        assert final_workflow_count == initial_workflow_count

    def test_convert_app_model_config_to_workflow_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful conversion of app model config to workflow.

        This test verifies:
        - Proper app model config to workflow conversion
        - Correct workflow graph structure
        - Proper node creation and configuration
        - Database state management
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )
        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant, account)

        # Act: Execute the conversion
        workflow_converter = WorkflowConverter()
        workflow = workflow_converter.convert_app_model_config_to_workflow(
            app_model=app,
            app_model_config=app.app_model_config,
            account_id=account.id,
        )

        # Assert: Verify the expected outcomes
        assert workflow is not None
        assert workflow.tenant_id == app.tenant_id
        assert workflow.app_id == app.id
        assert workflow.type == "chat"
        assert workflow.version == Workflow.VERSION_DRAFT
        assert workflow.created_by == account.id

        # Verify workflow graph structure
        graph = json.loads(workflow.graph)
        assert "nodes" in graph
        assert "edges" in graph
        assert len(graph["nodes"]) > 0
        assert len(graph["edges"]) > 0

        # Verify start node exists
        start_node = next((node for node in graph["nodes"] if node["data"]["type"] == "start"), None)
        assert start_node is not None
        assert start_node["id"] == "start"

        # Verify LLM node exists
        llm_node = next((node for node in graph["nodes"] if node["data"]["type"] == "llm"), None)
        assert llm_node is not None
        assert llm_node["id"] == "llm"

        # Verify answer node exists for chat mode
        answer_node = next((node for node in graph["nodes"] if node["data"]["type"] == "answer"), None)
        assert answer_node is not None
        assert answer_node["id"] == "answer"

        # Verify database state
        from extensions.ext_database import db

        db.session.refresh(workflow)
        assert workflow.id is not None

        # Verify features were set
        features = json.loads(workflow._features) if workflow._features else {}
        assert isinstance(features, dict)

    def test_convert_to_start_node_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful conversion to start node.

        This test verifies:
        - Proper start node creation with variables
        - Correct node structure and data
        - Variable encoding and formatting
        """
        # Arrange: Create test variables
        variables = [
            VariableEntity(
                variable="text_input",
                label="Text Input",
                type=VariableEntityType.TEXT_INPUT,
            ),
            VariableEntity(
                variable="number_input",
                label="Number Input",
                type=VariableEntityType.NUMBER,
            ),
        ]

        # Act: Execute the conversion
        workflow_converter = WorkflowConverter()
        start_node = workflow_converter._convert_to_start_node(variables=variables)

        # Assert: Verify the expected outcomes
        assert start_node is not None
        assert start_node["id"] == "start"
        assert start_node["data"]["title"] == "START"
        assert start_node["data"]["type"] == "start"
        assert len(start_node["data"]["variables"]) == 2

        # Verify variable encoding
        first_variable = start_node["data"]["variables"][0]
        assert first_variable["variable"] == "text_input"
        assert first_variable["label"] == "Text Input"
        assert first_variable["type"] == "text-input"

        second_variable = start_node["data"]["variables"][1]
        assert second_variable["variable"] == "number_input"
        assert second_variable["label"] == "Number Input"
        assert second_variable["type"] == "number"

    def test_convert_to_http_request_node_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful conversion to HTTP request node.

        This test verifies:
        - Proper HTTP request node creation
        - Correct API configuration and authorization
        - Code node creation for response parsing
        - External data variable mapping
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        app = self._create_test_app(db_session_with_containers, mock_external_service_dependencies, tenant, account)

        # Create API based extension
        api_based_extension = APIBasedExtension(
            tenant_id=tenant.id,
            name="Test API Extension",
            api_key="encrypted_api_key",
            api_endpoint="https://api.example.com/test",
        )

        from extensions.ext_database import db

        db.session.add(api_based_extension)
        db.session.commit()

        # Mock encrypter
        mock_external_service_dependencies["encrypter"].decrypt_token.return_value = "decrypted_api_key"

        variables = [
            VariableEntity(
                variable="user_input",
                label="User Input",
                type=VariableEntityType.TEXT_INPUT,
            )
        ]

        external_data_variables = [
            ExternalDataVariableEntity(
                variable="external_data", type="api", config={"api_based_extension_id": api_based_extension.id}
            )
        ]

        # Act: Execute the conversion
        workflow_converter = WorkflowConverter()
        nodes, external_data_variable_node_mapping = workflow_converter._convert_to_http_request_node(
            app_model=app,
            variables=variables,
            external_data_variables=external_data_variables,
        )

        # Assert: Verify the expected outcomes
        assert len(nodes) == 2  # HTTP request node + code node
        assert len(external_data_variable_node_mapping) == 1

        # Verify HTTP request node
        http_request_node = nodes[0]
        assert http_request_node["data"]["type"] == "http-request"
        assert http_request_node["data"]["method"] == "post"
        assert http_request_node["data"]["url"] == api_based_extension.api_endpoint
        assert http_request_node["data"]["authorization"]["type"] == "api-key"
        assert http_request_node["data"]["authorization"]["config"]["type"] == "bearer"
        assert http_request_node["data"]["authorization"]["config"]["api_key"] == "decrypted_api_key"

        # Verify code node
        code_node = nodes[1]
        assert code_node["data"]["type"] == "code"
        assert code_node["data"]["code_language"] == "python3"
        assert "response_json" in code_node["data"]["variables"][0]["variable"]

        # Verify mapping
        assert external_data_variable_node_mapping["external_data"] == code_node["id"]

    def test_convert_to_knowledge_retrieval_node_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful conversion to knowledge retrieval node.

        This test verifies:
        - Proper knowledge retrieval node creation
        - Correct dataset configuration
        - Model configuration integration
        - Query variable selector setup
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create dataset config
        dataset_config = DatasetEntity(
            dataset_ids=["dataset_1", "dataset_2"],
            retrieve_config=DatasetRetrieveConfigEntity(
                retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE,
                top_k=10,
                score_threshold=0.8,
                reranking_model={"provider": "cohere", "model": "rerank-v2"},
                reranking_enabled=True,
            ),
        )

        model_config = ModelConfigEntity(
            provider="openai",
            model="gpt-4",
            mode=LLMMode.CHAT,
            parameters={"temperature": 0.7},
            stop=[],
        )

        # Act: Execute the conversion for advanced chat mode
        workflow_converter = WorkflowConverter()
        node = workflow_converter._convert_to_knowledge_retrieval_node(
            new_app_mode=AppMode.ADVANCED_CHAT,
            dataset_config=dataset_config,
            model_config=model_config,
        )

        # Assert: Verify the expected outcomes
        assert node is not None
        assert node["data"]["type"] == "knowledge-retrieval"
        assert node["data"]["title"] == "KNOWLEDGE RETRIEVAL"
        assert node["data"]["dataset_ids"] == ["dataset_1", "dataset_2"]
        assert node["data"]["retrieval_mode"] == "multiple"
        assert node["data"]["query_variable_selector"] == ["sys", "query"]

        # Verify multiple retrieval config
        multiple_config = node["data"]["multiple_retrieval_config"]
        assert multiple_config["top_k"] == 10
        assert multiple_config["score_threshold"] == 0.8
        assert multiple_config["reranking_model"]["provider"] == "cohere"
        assert multiple_config["reranking_model"]["model"] == "rerank-v2"

        # Verify single retrieval config is None for multiple strategy
        assert node["data"]["single_retrieval_config"] is None

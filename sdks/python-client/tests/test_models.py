"""Unit tests for response models."""

import unittest
import json
from datetime import datetime
from dify_client.models import (
    BaseResponse,
    ErrorResponse,
    FileInfo,
    MessageResponse,
    ConversationResponse,
    DatasetResponse,
    DocumentResponse,
    DocumentSegmentResponse,
    WorkflowRunResponse,
    ApplicationParametersResponse,
    AnnotationResponse,
    PaginatedResponse,
    ConversationVariableResponse,
    FileUploadResponse,
    AudioResponse,
    SuggestedQuestionsResponse,
    AppInfoResponse,
    WorkspaceModelsResponse,
    HitTestingResponse,
    DatasetTagsResponse,
    WorkflowLogsResponse,
    ModelProviderResponse,
    FileInfoResponse,
    WorkflowDraftResponse,
    ApiTokenResponse,
    JobStatusResponse,
    DatasetQueryResponse,
    DatasetTemplateResponse,
)


class TestResponseModels(unittest.TestCase):
    """Test cases for response model classes."""

    def test_base_response(self):
        """Test BaseResponse model."""
        response = BaseResponse(success=True, message="Operation successful")
        self.assertTrue(response.success)
        self.assertEqual(response.message, "Operation successful")

    def test_base_response_defaults(self):
        """Test BaseResponse with default values."""
        response = BaseResponse(success=True)
        self.assertTrue(response.success)
        self.assertIsNone(response.message)

    def test_error_response(self):
        """Test ErrorResponse model."""
        response = ErrorResponse(
            success=False,
            message="Error occurred",
            error_code="VALIDATION_ERROR",
            details={"field": "invalid_value"},
        )
        self.assertFalse(response.success)
        self.assertEqual(response.message, "Error occurred")
        self.assertEqual(response.error_code, "VALIDATION_ERROR")
        self.assertEqual(response.details["field"], "invalid_value")

    def test_file_info(self):
        """Test FileInfo model."""
        now = datetime.now()
        file_info = FileInfo(
            id="file_123",
            name="test.txt",
            size=1024,
            mime_type="text/plain",
            url="https://example.com/file.txt",
            created_at=now,
        )
        self.assertEqual(file_info.id, "file_123")
        self.assertEqual(file_info.name, "test.txt")
        self.assertEqual(file_info.size, 1024)
        self.assertEqual(file_info.mime_type, "text/plain")
        self.assertEqual(file_info.url, "https://example.com/file.txt")
        self.assertEqual(file_info.created_at, now)

    def test_message_response(self):
        """Test MessageResponse model."""
        response = MessageResponse(
            success=True,
            id="msg_123",
            answer="Hello, world!",
            conversation_id="conv_123",
            created_at=1234567890,
            metadata={"model": "gpt-4"},
            files=[{"id": "file_1", "type": "image"}],
        )
        self.assertTrue(response.success)
        self.assertEqual(response.id, "msg_123")
        self.assertEqual(response.answer, "Hello, world!")
        self.assertEqual(response.conversation_id, "conv_123")
        self.assertEqual(response.created_at, 1234567890)
        self.assertEqual(response.metadata["model"], "gpt-4")
        self.assertEqual(response.files[0]["id"], "file_1")

    def test_conversation_response(self):
        """Test ConversationResponse model."""
        response = ConversationResponse(
            success=True,
            id="conv_123",
            name="Test Conversation",
            inputs={"query": "Hello"},
            status="active",
            created_at=1234567890,
            updated_at=1234567891,
        )
        self.assertTrue(response.success)
        self.assertEqual(response.id, "conv_123")
        self.assertEqual(response.name, "Test Conversation")
        self.assertEqual(response.inputs["query"], "Hello")
        self.assertEqual(response.status, "active")
        self.assertEqual(response.created_at, 1234567890)
        self.assertEqual(response.updated_at, 1234567891)

    def test_dataset_response(self):
        """Test DatasetResponse model."""
        response = DatasetResponse(
            success=True,
            id="dataset_123",
            name="Test Dataset",
            description="A test dataset",
            permission="read",
            indexing_technique="high_quality",
            embedding_model="text-embedding-ada-002",
            embedding_model_provider="openai",
            retrieval_model={"search_type": "semantic"},
            document_count=10,
            word_count=5000,
            app_count=2,
            created_at=1234567890,
            updated_at=1234567891,
        )
        self.assertTrue(response.success)
        self.assertEqual(response.id, "dataset_123")
        self.assertEqual(response.name, "Test Dataset")
        self.assertEqual(response.description, "A test dataset")
        self.assertEqual(response.permission, "read")
        self.assertEqual(response.indexing_technique, "high_quality")
        self.assertEqual(response.embedding_model, "text-embedding-ada-002")
        self.assertEqual(response.embedding_model_provider, "openai")
        self.assertEqual(response.retrieval_model["search_type"], "semantic")
        self.assertEqual(response.document_count, 10)
        self.assertEqual(response.word_count, 5000)
        self.assertEqual(response.app_count, 2)

    def test_document_response(self):
        """Test DocumentResponse model."""
        response = DocumentResponse(
            success=True,
            id="doc_123",
            name="test_document.txt",
            data_source_type="upload_file",
            position=1,
            enabled=True,
            word_count=1000,
            hit_count=5,
            doc_form="text_model",
            created_at=1234567890.0,
            indexing_status="completed",
            completed_at=1234567891.0,
        )
        self.assertTrue(response.success)
        self.assertEqual(response.id, "doc_123")
        self.assertEqual(response.name, "test_document.txt")
        self.assertEqual(response.data_source_type, "upload_file")
        self.assertEqual(response.position, 1)
        self.assertTrue(response.enabled)
        self.assertEqual(response.word_count, 1000)
        self.assertEqual(response.hit_count, 5)
        self.assertEqual(response.doc_form, "text_model")
        self.assertEqual(response.created_at, 1234567890.0)
        self.assertEqual(response.indexing_status, "completed")
        self.assertEqual(response.completed_at, 1234567891.0)

    def test_document_segment_response(self):
        """Test DocumentSegmentResponse model."""
        response = DocumentSegmentResponse(
            success=True,
            id="seg_123",
            position=1,
            document_id="doc_123",
            content="This is a test segment.",
            answer="Test answer",
            word_count=5,
            tokens=10,
            keywords=["test", "segment"],
            hit_count=2,
            enabled=True,
            status="completed",
            created_at=1234567890.0,
            completed_at=1234567891.0,
        )
        self.assertTrue(response.success)
        self.assertEqual(response.id, "seg_123")
        self.assertEqual(response.position, 1)
        self.assertEqual(response.document_id, "doc_123")
        self.assertEqual(response.content, "This is a test segment.")
        self.assertEqual(response.answer, "Test answer")
        self.assertEqual(response.word_count, 5)
        self.assertEqual(response.tokens, 10)
        self.assertEqual(response.keywords, ["test", "segment"])
        self.assertEqual(response.hit_count, 2)
        self.assertTrue(response.enabled)
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.created_at, 1234567890.0)
        self.assertEqual(response.completed_at, 1234567891.0)

    def test_workflow_run_response(self):
        """Test WorkflowRunResponse model."""
        response = WorkflowRunResponse(
            success=True,
            id="run_123",
            workflow_id="workflow_123",
            status="succeeded",
            inputs={"query": "test"},
            outputs={"answer": "result"},
            elapsed_time=5.5,
            total_tokens=100,
            total_steps=3,
            created_at=1234567890.0,
            finished_at=1234567895.5,
        )
        self.assertTrue(response.success)
        self.assertEqual(response.id, "run_123")
        self.assertEqual(response.workflow_id, "workflow_123")
        self.assertEqual(response.status, "succeeded")
        self.assertEqual(response.inputs["query"], "test")
        self.assertEqual(response.outputs["answer"], "result")
        self.assertEqual(response.elapsed_time, 5.5)
        self.assertEqual(response.total_tokens, 100)
        self.assertEqual(response.total_steps, 3)
        self.assertEqual(response.created_at, 1234567890.0)
        self.assertEqual(response.finished_at, 1234567895.5)

    def test_application_parameters_response(self):
        """Test ApplicationParametersResponse model."""
        response = ApplicationParametersResponse(
            success=True,
            opening_statement="Hello! How can I help you?",
            suggested_questions=["What is AI?", "How does this work?"],
            speech_to_text={"enabled": True},
            text_to_speech={"enabled": False, "voice": "alloy"},
            retriever_resource={"enabled": True},
            sensitive_word_avoidance={"enabled": False},
            file_upload={"enabled": True, "file_size_limit": 10485760},
            system_parameters={"max_tokens": 1000},
            user_input_form=[{"type": "text", "label": "Query"}],
        )
        self.assertTrue(response.success)
        self.assertEqual(response.opening_statement, "Hello! How can I help you?")
        self.assertEqual(
            response.suggested_questions, ["What is AI?", "How does this work?"]
        )
        self.assertTrue(response.speech_to_text["enabled"])
        self.assertFalse(response.text_to_speech["enabled"])
        self.assertEqual(response.text_to_speech["voice"], "alloy")
        self.assertTrue(response.retriever_resource["enabled"])
        self.assertFalse(response.sensitive_word_avoidance["enabled"])
        self.assertTrue(response.file_upload["enabled"])
        self.assertEqual(response.file_upload["file_size_limit"], 10485760)
        self.assertEqual(response.system_parameters["max_tokens"], 1000)
        self.assertEqual(response.user_input_form[0]["type"], "text")

    def test_annotation_response(self):
        """Test AnnotationResponse model."""
        response = AnnotationResponse(
            success=True,
            id="annotation_123",
            question="What is the capital of France?",
            answer="Paris",
            content="Additional context",
            created_at=1234567890.0,
            updated_at=1234567891.0,
            created_by="user_123",
            updated_by="user_123",
            hit_count=5,
        )
        self.assertTrue(response.success)
        self.assertEqual(response.id, "annotation_123")
        self.assertEqual(response.question, "What is the capital of France?")
        self.assertEqual(response.answer, "Paris")
        self.assertEqual(response.content, "Additional context")
        self.assertEqual(response.created_at, 1234567890.0)
        self.assertEqual(response.updated_at, 1234567891.0)
        self.assertEqual(response.created_by, "user_123")
        self.assertEqual(response.updated_by, "user_123")
        self.assertEqual(response.hit_count, 5)

    def test_paginated_response(self):
        """Test PaginatedResponse model."""
        response = PaginatedResponse(
            success=True,
            data=[{"id": 1}, {"id": 2}, {"id": 3}],
            has_more=True,
            limit=10,
            total=100,
            page=1,
        )
        self.assertTrue(response.success)
        self.assertEqual(len(response.data), 3)
        self.assertEqual(response.data[0]["id"], 1)
        self.assertTrue(response.has_more)
        self.assertEqual(response.limit, 10)
        self.assertEqual(response.total, 100)
        self.assertEqual(response.page, 1)

    def test_conversation_variable_response(self):
        """Test ConversationVariableResponse model."""
        response = ConversationVariableResponse(
            success=True,
            conversation_id="conv_123",
            variables=[
                {"id": "var_1", "name": "user_name", "value": "John"},
                {"id": "var_2", "name": "preferences", "value": {"theme": "dark"}},
            ],
        )
        self.assertTrue(response.success)
        self.assertEqual(response.conversation_id, "conv_123")
        self.assertEqual(len(response.variables), 2)
        self.assertEqual(response.variables[0]["name"], "user_name")
        self.assertEqual(response.variables[0]["value"], "John")
        self.assertEqual(response.variables[1]["name"], "preferences")
        self.assertEqual(response.variables[1]["value"]["theme"], "dark")

    def test_file_upload_response(self):
        """Test FileUploadResponse model."""
        response = FileUploadResponse(
            success=True,
            id="file_123",
            name="test.txt",
            size=1024,
            mime_type="text/plain",
            url="https://example.com/files/test.txt",
            created_at=1234567890.0,
        )
        self.assertTrue(response.success)
        self.assertEqual(response.id, "file_123")
        self.assertEqual(response.name, "test.txt")
        self.assertEqual(response.size, 1024)
        self.assertEqual(response.mime_type, "text/plain")
        self.assertEqual(response.url, "https://example.com/files/test.txt")
        self.assertEqual(response.created_at, 1234567890.0)

    def test_audio_response(self):
        """Test AudioResponse model."""
        response = AudioResponse(
            success=True,
            audio="base64_encoded_audio_data",
            audio_url="https://example.com/audio.mp3",
            duration=10.5,
            sample_rate=44100,
        )
        self.assertTrue(response.success)
        self.assertEqual(response.audio, "base64_encoded_audio_data")
        self.assertEqual(response.audio_url, "https://example.com/audio.mp3")
        self.assertEqual(response.duration, 10.5)
        self.assertEqual(response.sample_rate, 44100)

    def test_suggested_questions_response(self):
        """Test SuggestedQuestionsResponse model."""
        response = SuggestedQuestionsResponse(
            success=True,
            message_id="msg_123",
            questions=[
                "What is machine learning?",
                "How does AI work?",
                "Can you explain neural networks?",
            ],
        )
        self.assertTrue(response.success)
        self.assertEqual(response.message_id, "msg_123")
        self.assertEqual(len(response.questions), 3)
        self.assertEqual(response.questions[0], "What is machine learning?")

    def test_app_info_response(self):
        """Test AppInfoResponse model."""
        response = AppInfoResponse(
            success=True,
            id="app_123",
            name="Test App",
            description="A test application",
            icon="🤖",
            icon_background="#FF6B6B",
            mode="chat",
            tags=["AI", "Chat", "Test"],
            enable_site=True,
            enable_api=True,
            api_token="app_token_123",
        )
        self.assertTrue(response.success)
        self.assertEqual(response.id, "app_123")
        self.assertEqual(response.name, "Test App")
        self.assertEqual(response.description, "A test application")
        self.assertEqual(response.icon, "🤖")
        self.assertEqual(response.icon_background, "#FF6B6B")
        self.assertEqual(response.mode, "chat")
        self.assertEqual(response.tags, ["AI", "Chat", "Test"])
        self.assertTrue(response.enable_site)
        self.assertTrue(response.enable_api)
        self.assertEqual(response.api_token, "app_token_123")

    def test_workspace_models_response(self):
        """Test WorkspaceModelsResponse model."""
        response = WorkspaceModelsResponse(
            success=True,
            models=[
                {"id": "gpt-4", "name": "GPT-4", "provider": "openai"},
                {"id": "claude-3", "name": "Claude 3", "provider": "anthropic"},
            ],
        )
        self.assertTrue(response.success)
        self.assertEqual(len(response.models), 2)
        self.assertEqual(response.models[0]["id"], "gpt-4")
        self.assertEqual(response.models[0]["name"], "GPT-4")
        self.assertEqual(response.models[0]["provider"], "openai")

    def test_hit_testing_response(self):
        """Test HitTestingResponse model."""
        response = HitTestingResponse(
            success=True,
            query="What is machine learning?",
            records=[
                {"content": "Machine learning is a subset of AI...", "score": 0.95},
                {"content": "ML algorithms learn from data...", "score": 0.87},
            ],
        )
        self.assertTrue(response.success)
        self.assertEqual(response.query, "What is machine learning?")
        self.assertEqual(len(response.records), 2)
        self.assertEqual(response.records[0]["score"], 0.95)

    def test_dataset_tags_response(self):
        """Test DatasetTagsResponse model."""
        response = DatasetTagsResponse(
            success=True,
            tags=[
                {"id": "tag_1", "name": "Technology", "color": "#FF0000"},
                {"id": "tag_2", "name": "Science", "color": "#00FF00"},
            ],
        )
        self.assertTrue(response.success)
        self.assertEqual(len(response.tags), 2)
        self.assertEqual(response.tags[0]["name"], "Technology")
        self.assertEqual(response.tags[0]["color"], "#FF0000")

    def test_workflow_logs_response(self):
        """Test WorkflowLogsResponse model."""
        response = WorkflowLogsResponse(
            success=True,
            logs=[
                {"id": "log_1", "status": "succeeded", "created_at": 1234567890},
                {"id": "log_2", "status": "failed", "created_at": 1234567891},
            ],
            total=50,
            page=1,
            limit=10,
            has_more=True,
        )
        self.assertTrue(response.success)
        self.assertEqual(len(response.logs), 2)
        self.assertEqual(response.logs[0]["status"], "succeeded")
        self.assertEqual(response.total, 50)
        self.assertEqual(response.page, 1)
        self.assertEqual(response.limit, 10)
        self.assertTrue(response.has_more)

    def test_model_serialization(self):
        """Test that models can be serialized to JSON."""
        response = MessageResponse(
            success=True,
            id="msg_123",
            answer="Hello, world!",
            conversation_id="conv_123",
        )

        # Convert to dict and then to JSON
        response_dict = {
            "success": response.success,
            "id": response.id,
            "answer": response.answer,
            "conversation_id": response.conversation_id,
        }

        json_str = json.dumps(response_dict)
        parsed = json.loads(json_str)

        self.assertTrue(parsed["success"])
        self.assertEqual(parsed["id"], "msg_123")
        self.assertEqual(parsed["answer"], "Hello, world!")
        self.assertEqual(parsed["conversation_id"], "conv_123")

    # Tests for new response models
    def test_model_provider_response(self):
        """Test ModelProviderResponse model."""
        response = ModelProviderResponse(
            success=True,
            provider_name="openai",
            provider_type="llm",
            models=[
                {"id": "gpt-4", "name": "GPT-4", "max_tokens": 8192},
                {"id": "gpt-3.5-turbo", "name": "GPT-3.5 Turbo", "max_tokens": 4096},
            ],
            is_enabled=True,
            credentials={"api_key": "sk-..."},
        )
        self.assertTrue(response.success)
        self.assertEqual(response.provider_name, "openai")
        self.assertEqual(response.provider_type, "llm")
        self.assertEqual(len(response.models), 2)
        self.assertEqual(response.models[0]["id"], "gpt-4")
        self.assertTrue(response.is_enabled)
        self.assertEqual(response.credentials["api_key"], "sk-...")

    def test_file_info_response(self):
        """Test FileInfoResponse model."""
        response = FileInfoResponse(
            success=True,
            id="file_123",
            name="document.pdf",
            size=2048576,
            mime_type="application/pdf",
            url="https://example.com/files/document.pdf",
            created_at=1234567890,
            metadata={"pages": 10, "author": "John Doe"},
        )
        self.assertTrue(response.success)
        self.assertEqual(response.id, "file_123")
        self.assertEqual(response.name, "document.pdf")
        self.assertEqual(response.size, 2048576)
        self.assertEqual(response.mime_type, "application/pdf")
        self.assertEqual(response.url, "https://example.com/files/document.pdf")
        self.assertEqual(response.created_at, 1234567890)
        self.assertEqual(response.metadata["pages"], 10)

    def test_workflow_draft_response(self):
        """Test WorkflowDraftResponse model."""
        response = WorkflowDraftResponse(
            success=True,
            id="draft_123",
            app_id="app_456",
            draft_data={"nodes": [], "edges": [], "config": {"name": "Test Workflow"}},
            version=1,
            created_at=1234567890,
            updated_at=1234567891,
        )
        self.assertTrue(response.success)
        self.assertEqual(response.id, "draft_123")
        self.assertEqual(response.app_id, "app_456")
        self.assertEqual(response.draft_data["config"]["name"], "Test Workflow")
        self.assertEqual(response.version, 1)
        self.assertEqual(response.created_at, 1234567890)
        self.assertEqual(response.updated_at, 1234567891)

    def test_api_token_response(self):
        """Test ApiTokenResponse model."""
        response = ApiTokenResponse(
            success=True,
            id="token_123",
            name="Production Token",
            token="app-xxxxxxxxxxxx",
            description="Token for production environment",
            created_at=1234567890,
            last_used_at=1234567891,
            is_active=True,
        )
        self.assertTrue(response.success)
        self.assertEqual(response.id, "token_123")
        self.assertEqual(response.name, "Production Token")
        self.assertEqual(response.token, "app-xxxxxxxxxxxx")
        self.assertEqual(response.description, "Token for production environment")
        self.assertEqual(response.created_at, 1234567890)
        self.assertEqual(response.last_used_at, 1234567891)
        self.assertTrue(response.is_active)

    def test_job_status_response(self):
        """Test JobStatusResponse model."""
        response = JobStatusResponse(
            success=True,
            job_id="job_123",
            job_status="running",
            error_msg=None,
            progress=0.75,
            created_at=1234567890,
            updated_at=1234567891,
        )
        self.assertTrue(response.success)
        self.assertEqual(response.job_id, "job_123")
        self.assertEqual(response.job_status, "running")
        self.assertIsNone(response.error_msg)
        self.assertEqual(response.progress, 0.75)
        self.assertEqual(response.created_at, 1234567890)
        self.assertEqual(response.updated_at, 1234567891)

    def test_dataset_query_response(self):
        """Test DatasetQueryResponse model."""
        response = DatasetQueryResponse(
            success=True,
            query="What is machine learning?",
            records=[
                {"content": "Machine learning is...", "score": 0.95},
                {"content": "ML algorithms...", "score": 0.87},
            ],
            total=2,
            search_time=0.123,
            retrieval_model={"method": "semantic_search", "top_k": 3},
        )
        self.assertTrue(response.success)
        self.assertEqual(response.query, "What is machine learning?")
        self.assertEqual(len(response.records), 2)
        self.assertEqual(response.total, 2)
        self.assertEqual(response.search_time, 0.123)
        self.assertEqual(response.retrieval_model["method"], "semantic_search")

    def test_dataset_template_response(self):
        """Test DatasetTemplateResponse model."""
        response = DatasetTemplateResponse(
            success=True,
            template_name="customer_support",
            display_name="Customer Support",
            description="Template for customer support knowledge base",
            category="support",
            icon="🎧",
            config_schema={"fields": [{"name": "category", "type": "string"}]},
        )
        self.assertTrue(response.success)
        self.assertEqual(response.template_name, "customer_support")
        self.assertEqual(response.display_name, "Customer Support")
        self.assertEqual(
            response.description, "Template for customer support knowledge base"
        )
        self.assertEqual(response.category, "support")
        self.assertEqual(response.icon, "🎧")
        self.assertEqual(response.config_schema["fields"][0]["name"], "category")


if __name__ == "__main__":
    unittest.main()

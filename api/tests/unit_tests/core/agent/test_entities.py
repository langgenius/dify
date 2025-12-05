"""Tests for agent entities."""

from core.agent.entities import AgentEntity, AgentLog, AgentPromptEntity, AgentScratchpadUnit, ExecutionContext


class TestExecutionContext:
    """Tests for ExecutionContext entity."""

    def test_create_with_all_fields(self):
        """Test creating ExecutionContext with all fields."""
        context = ExecutionContext(
            user_id="user-123",
            app_id="app-456",
            conversation_id="conv-789",
            message_id="msg-012",
            tenant_id="tenant-345",
        )

        assert context.user_id == "user-123"
        assert context.app_id == "app-456"
        assert context.conversation_id == "conv-789"
        assert context.message_id == "msg-012"
        assert context.tenant_id == "tenant-345"

    def test_create_minimal(self):
        """Test creating minimal ExecutionContext."""
        context = ExecutionContext.create_minimal(user_id="user-123")

        assert context.user_id == "user-123"
        assert context.app_id is None
        assert context.conversation_id is None
        assert context.message_id is None
        assert context.tenant_id is None

    def test_to_dict(self):
        """Test converting ExecutionContext to dictionary."""
        context = ExecutionContext(
            user_id="user-123",
            app_id="app-456",
            conversation_id="conv-789",
            message_id="msg-012",
            tenant_id="tenant-345",
        )

        result = context.to_dict()

        assert result == {
            "user_id": "user-123",
            "app_id": "app-456",
            "conversation_id": "conv-789",
            "message_id": "msg-012",
            "tenant_id": "tenant-345",
        }

    def test_with_updates(self):
        """Test creating new context with updates."""
        original = ExecutionContext(
            user_id="user-123",
            app_id="app-456",
        )

        updated = original.with_updates(message_id="msg-789")

        # Original should be unchanged
        assert original.message_id is None
        # Updated should have new value
        assert updated.message_id == "msg-789"
        assert updated.user_id == "user-123"
        assert updated.app_id == "app-456"


class TestAgentLog:
    """Tests for AgentLog entity."""

    def test_create_log_with_required_fields(self):
        """Test creating AgentLog with required fields."""
        log = AgentLog(
            label="ROUND 1",
            log_type=AgentLog.LogType.ROUND,
            status=AgentLog.LogStatus.START,
            data={"key": "value"},
        )

        assert log.label == "ROUND 1"
        assert log.log_type == AgentLog.LogType.ROUND
        assert log.status == AgentLog.LogStatus.START
        assert log.data == {"key": "value"}
        assert log.id is not None  # Auto-generated
        assert log.parent_id is None
        assert log.error is None

    def test_log_type_enum(self):
        """Test LogType enum values."""
        assert AgentLog.LogType.ROUND == "round"
        assert AgentLog.LogType.THOUGHT == "thought"
        assert AgentLog.LogType.TOOL_CALL == "tool_call"

    def test_log_status_enum(self):
        """Test LogStatus enum values."""
        assert AgentLog.LogStatus.START == "start"
        assert AgentLog.LogStatus.SUCCESS == "success"
        assert AgentLog.LogStatus.ERROR == "error"

    def test_log_metadata_enum(self):
        """Test LogMetadata enum values."""
        assert AgentLog.LogMetadata.STARTED_AT == "started_at"
        assert AgentLog.LogMetadata.FINISHED_AT == "finished_at"
        assert AgentLog.LogMetadata.ELAPSED_TIME == "elapsed_time"
        assert AgentLog.LogMetadata.TOTAL_PRICE == "total_price"
        assert AgentLog.LogMetadata.TOTAL_TOKENS == "total_tokens"
        assert AgentLog.LogMetadata.LLM_USAGE == "llm_usage"


class TestAgentScratchpadUnit:
    """Tests for AgentScratchpadUnit entity."""

    def test_is_final_with_final_answer_action(self):
        """Test is_final returns True for Final Answer action."""
        unit = AgentScratchpadUnit(
            thought="I know the answer",
            action=AgentScratchpadUnit.Action(
                action_name="Final Answer",
                action_input="The answer is 42",
            ),
        )

        assert unit.is_final() is True

    def test_is_final_with_tool_action(self):
        """Test is_final returns False for tool action."""
        unit = AgentScratchpadUnit(
            thought="I need to search",
            action=AgentScratchpadUnit.Action(
                action_name="search",
                action_input={"query": "test"},
            ),
        )

        assert unit.is_final() is False

    def test_is_final_with_no_action(self):
        """Test is_final returns True when no action."""
        unit = AgentScratchpadUnit(
            thought="Just thinking",
        )

        assert unit.is_final() is True

    def test_action_to_dict(self):
        """Test Action.to_dict method."""
        action = AgentScratchpadUnit.Action(
            action_name="search",
            action_input={"query": "test"},
        )

        result = action.to_dict()

        assert result == {
            "action": "search",
            "action_input": {"query": "test"},
        }


class TestAgentEntity:
    """Tests for AgentEntity."""

    def test_strategy_enum(self):
        """Test Strategy enum values."""
        assert AgentEntity.Strategy.CHAIN_OF_THOUGHT == "chain-of-thought"
        assert AgentEntity.Strategy.FUNCTION_CALLING == "function-calling"

    def test_create_with_prompt(self):
        """Test creating AgentEntity with prompt."""
        prompt = AgentPromptEntity(
            first_prompt="You are a helpful assistant.",
            next_iteration="Continue thinking...",
        )

        entity = AgentEntity(
            provider="openai",
            model="gpt-4",
            strategy=AgentEntity.Strategy.CHAIN_OF_THOUGHT,
            prompt=prompt,
            max_iteration=5,
        )

        assert entity.provider == "openai"
        assert entity.model == "gpt-4"
        assert entity.strategy == AgentEntity.Strategy.CHAIN_OF_THOUGHT
        assert entity.prompt == prompt
        assert entity.max_iteration == 5

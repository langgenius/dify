from collections.abc import Generator, Mapping, Sequence
from typing import override
from unittest.mock import MagicMock

from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage, ToolProviderType
from repositories.knowledge.retrieval_repository import KnowledgeRetrievalRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.knowledge.retrieval.adapters.resource_events import DatasetIndexToolCallbackHandler
from services.knowledge.retrieval.adapters.threads import retrieval_thread
from services.knowledge.retrieval.dataset_retrieval import DatasetRetrieval
from services.knowledge.retrieval.reranking import KnowledgeReranker
from services.tools.dataset.tool import DatasetRetrieverTool
from services.tools.tool_engine import ToolEngine
from tests.unit_tests.model_factories import make_message


def _entity(name: str) -> ToolEntity:
    return ToolEntity(
        identity=ToolIdentity(
            author="test",
            name=name,
            label=I18nObject(en_US=name),
            provider="test-provider",
        )
    )


class _SessionRecordingTool(Tool):
    def __init__(self) -> None:
        super().__init__(
            entity=_entity("session-recorder"),
            runtime=ToolRuntime(tenant_id="tenant-1", user_id="user-1"),
        )
        self.sessions: list[Session] = []

    @override
    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.BUILT_IN

    @override
    def _invoke(
        self,
        session: Session,
        user_id: str,
        tool_parameters: dict[str, object],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        self.sessions.append(session)
        yield self.create_text_message("ok")


class _NoMessageFiles:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, Sequence[Mapping[str, object]]]] = []

    def create_message_files(
        self, *, tenant_id: str, message_id: str, files: Sequence[Mapping[str, object]]
    ) -> list[str]:
        self.calls.append((tenant_id, message_id, files))
        return []


def test_generic_invoke_forwards_the_same_session_to_tool() -> None:
    tool = _SessionRecordingTool()

    with Session() as session:
        messages = list(
            ToolEngine.generic_invoke(
                session=session,
                tool=tool,
                tool_parameters={"query": "hello"},
                user_id="user-1",
                workflow_tool_callback=DifyWorkflowCallbackHandler(),
                workflow_call_depth=0,
            )
        )

        assert tool.sessions == [session]

    assert len(messages) == 1
    assert messages[0].message == ToolInvokeMessage.TextMessage(text="ok")


def test_agent_invoke_forwards_the_same_session_to_tool() -> None:
    tool = _SessionRecordingTool()
    records = _NoMessageFiles()

    with Session() as session:
        text, files, meta = ToolEngine.agent_invoke(
            session=session,
            tool=tool,
            tool_parameters={"query": "hello"},
            user_id="user-1",
            tenant_id="tenant-1",
            message=make_message(message_id="message-1", conversation_id="conversation-1"),
            invoke_from=InvokeFrom.DEBUGGER,
            agent_tool_callback=DifyAgentCallbackHandler(),
            records=records,
        )

        assert tool.sessions == [session]

    assert text == "ok"
    assert files == []
    assert meta.error is None
    assert records.calls == []


def test_dataset_tool_public_invoke_accepts_explicit_session() -> None:
    retrieval_sessions: sessionmaker[Session] = sessionmaker()
    retrieval = DatasetRetrieval(
        records=KnowledgeRetrievalRepository(retrieval_sessions),
        rerank=KnowledgeReranker(SQLAlchemyKnowledgeUploadRepository(session_factory=retrieval_sessions)),
        thread=retrieval_thread,
    )
    tool = DatasetRetrieverTool(
        entity=_entity("dataset-retriever"),
        runtime=ToolRuntime(tenant_id="tenant-1", user_id="user-1"),
        retrieval=retrieval,
        dataset_id="dataset-1",
        config=DatasetRetrieveConfigEntity(retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE),
        top_k=2,
        inputs={},
        invoke_from=InvokeFrom.DEBUGGER,
        return_resource=False,
        hit_callback=DatasetIndexToolCallbackHandler(MagicMock()),
        app_id="app-1",
    )

    with Session() as session:
        messages = list(tool.invoke(session=session, user_id="user-1", tool_parameters={}))

    assert len(messages) == 1
    assert messages[0].message == ToolInvokeMessage.TextMessage(text="please input query")

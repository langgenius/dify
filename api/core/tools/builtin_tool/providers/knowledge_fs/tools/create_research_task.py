from collections.abc import Generator
from typing import Any, override

from pydantic import ValidationError
from sqlalchemy.orm import Session, sessionmaker

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeFrom, ToolInvokeMessage
from core.tools.errors import ToolInvokeError
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from services.knowledge_fs.app_execution_capability import KnowledgeResourceRef
from services.knowledge_fs.product_dto import KnowledgeFSResearchTaskCreatePayload
from services.knowledge_fs.runtime import create_knowledge_fs_runtime


class KnowledgeFSCreateResearchTaskTool(BuiltinTool):
    @override
    def _invoke(
        self,
        session: Session,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        _ = (user_id, conversation_id, app_id, message_id)
        run_context = self.runtime.dify_run_context
        if run_context is None or self.runtime.tenant_id != run_context.tenant_id:
            raise ToolInvokeError("KnowledgeFS requires a trusted Dify run context")
        match self.runtime.tool_invoke_from:
            case ToolInvokeFrom.AGENT:
                caller_kind = KnowledgeFSAppSpaceJoinType.AGENT
            case ToolInvokeFrom.WORKFLOW:
                caller_kind = KnowledgeFSAppSpaceJoinType.WORKFLOW
            case _:
                raise ToolInvokeError("KnowledgeFS is only available to Agent and Workflow callers")

        try:
            resource = KnowledgeResourceRef.model_validate(tool_parameters.get("resource"))
            payload_data: dict[str, object] = {
                "query": tool_parameters.get("query"),
            }
            mode = tool_parameters.get("mode")
            if mode:
                payload_data["mode"] = mode
            payload = KnowledgeFSResearchTaskCreatePayload.model_validate(payload_data)
            runtime = create_knowledge_fs_runtime(sessionmaker(bind=session.get_bind(), expire_on_commit=False))
            response = runtime.app_capabilities.create_research_task(
                run_context=run_context,
                caller_kind=caller_kind,
                resource=resource,
                payload=payload,
            )
        except ToolInvokeError:
            raise
        except (ValidationError, RuntimeError, ValueError) as exc:
            raise ToolInvokeError(str(exc)) from exc

        yield self.create_json_message(response.model_dump(mode="json", by_alias=True))

from flask_restx import reqparse

from controllers.web import api
from controllers.web.wraps import WebApiResource
from core.memory.entities import MemoryBlock, MemoryCreatedBy
from core.workflow.entities.variable_pool import VariablePool
from models import App, EndUser
from services.chatflow_memory_service import ChatflowMemoryService
from services.workflow_service import WorkflowService


class MemoryListApi(WebApiResource):
    def get(self, app_model: App, end_user: EndUser):
        parser = reqparse.RequestParser()
        parser.add_argument("conversation_id", required=False, type=str | None, default=None)
        parser.add_argument("memory_id", required=False, type=str | None, default=None)
        parser.add_argument("version", required=False, type=int | None, default=None)
        args = parser.parse_args()
        conversation_id: str | None = args.get("conversation_id")
        memory_id = args.get("memory_id")
        version = args.get("version")

        result = ChatflowMemoryService.get_persistent_memories(
            app_model,
            MemoryCreatedBy(end_user_id=end_user.id),
            version
        )
        if conversation_id:
            result = [
                *result,
                *ChatflowMemoryService.get_session_memories(
                    app_model,
                    MemoryCreatedBy(end_user_id=end_user.id),
                    conversation_id,
                    version
                )
            ]
        if memory_id:
            result = [it for it in result if it.spec.id == memory_id]
        return [it for it in result if it.spec.end_user_visible]


class MemoryEditApi(WebApiResource):
    def put(self, app_model: App, end_user: EndUser):
        parser = reqparse.RequestParser()
        parser.add_argument('id', type=str, required=True)
        parser.add_argument("conversation_id", type=str | None, required=False, default=None)
        parser.add_argument('node_id', type=str | None, required=False, default=None)
        parser.add_argument('update', type=str, required=True)
        args = parser.parse_args()
        workflow = WorkflowService().get_published_workflow(app_model)
        update = args.get("update")
        conversation_id = args.get("conversation_id")
        node_id = args.get("node_id")
        if not isinstance(update, str):
            return {'error': 'Update must be a string'}, 400
        if not workflow:
            return {'error': 'Workflow not found'}, 404
        memory_spec = next((it for it in workflow.memory_blocks if it.id == args['id']), None)
        if not memory_spec:
            return {'error': 'Memory not found'}, 404
        if not memory_spec.end_user_editable:
            return {'error': 'Memory not editable'}, 403
        ChatflowMemoryService.save_memory(
            MemoryBlock(
                spec=memory_spec,
                tenant_id=app_model.tenant_id,
                value=update,
                conversation_id=conversation_id,
                node_id=node_id,
                app_id=app_model.id,
                edited_by_user=True,
                created_by=MemoryCreatedBy(end_user_id=end_user.id)
            ),
            variable_pool=VariablePool(),
            is_draft=False
        )
        return '', 204


api.add_resource(MemoryListApi, '/memories')
api.add_resource(MemoryEditApi, '/memory-edit')

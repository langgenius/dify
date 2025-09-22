from flask_restx import Resource, reqparse

from controllers.service_api import api
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.memory.entities import MemoryBlock
from core.workflow.entities.variable_pool import VariablePool
from services.chatflow_memory_service import ChatflowMemoryService
from services.workflow_service import WorkflowService


class MemoryListApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def get(self, app_model):
        parser = reqparse.RequestParser()
        parser.add_argument("conversation_id", required=False, type=str | None, default=None)
        parser.add_argument("memory_id", required=False, type=str | None, default=None)
        parser.add_argument("version", required=False, type=int | None, default=None)
        args = parser.parse_args()
        conversation_id = args.get("conversation_id")
        memory_id = args.get("memory_id")
        version = args.get("version")

        result = ChatflowMemoryService.get_persistent_memories(app_model, version)
        if conversation_id:
            result = [*result, *ChatflowMemoryService.get_session_memories(app_model, conversation_id, version)]
        if memory_id:
            result = [it for it in result if it.memory_id == memory_id]
        return [it for it in result if it.end_user_visible]


class MemoryEditApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def put(self, app_model):
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
            return {'error': 'Invalid update'}, 400
        if not workflow:
            return {'error': 'Workflow not found'}, 404
        memory_spec = next((it for it in workflow.memory_blocks if it.id == args['id']), None)
        if not memory_spec:
            return {'error': 'Memory not found'}, 404
        ChatflowMemoryService.save_memory(
            MemoryBlock(
                spec=memory_spec,
                tenant_id=app_model.tenant_id,
                value=update,
                conversation_id=conversation_id,
                node_id=node_id,
                app_id=app_model.id,
            ),
            variable_pool=VariablePool(),
            is_draft=False
        )
        return '', 204


api.add_resource(MemoryListApi, '/memories')
api.add_resource(MemoryEditApi, '/memory-edit')

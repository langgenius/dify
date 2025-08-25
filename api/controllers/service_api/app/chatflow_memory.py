from flask_restx import Resource, reqparse
from sqlalchemy.orm import Session

from controllers.service_api import api
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from libs.helper import uuid_value
from models import db
from models.chatflow_memory import ChatflowMemoryVariable
from services.chatflow_memory_service import ChatflowMemoryService
from services.workflow_service import WorkflowService


class MemoryListApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def get(self, app_model):
        parser = reqparse.RequestParser()
        parser.add_argument("conversation_id", required=False, type=uuid_value, location="args")
        args = parser.parse_args()
        conversation_id = args.get("conversation_id")

        result = ChatflowMemoryService.get_persistent_memories(app_model)
        if conversation_id:
            result = [*result, *ChatflowMemoryService.get_session_memories(app_model, conversation_id)]

        return result

class MemoryEditApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def put(self, app_model):
        parser = reqparse.RequestParser()
        parser.add_argument('id', type=str, required=True)
        parser.add_argument('node_id', type=str, required=False, default=None)
        parser.add_argument('update', type=str, required=True)
        args = parser.parse_args()
        workflow = WorkflowService().get_published_workflow(app_model)
        if not workflow:
            return {'error': 'Workflow not found'}, 404
        memory_spec = next((it for it in workflow.memory_blocks if it.id == args['id']), None)
        if not memory_spec:
            return {'error': 'Memory not found'}, 404
        with Session(db.engine) as session:
            existing = session.query(ChatflowMemoryVariable).filter_by(
                memory_id=args['id'],
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                node_id=args['node_id']
            ).first()
            if existing:
                existing.value = args['update']
            else:
                session.add(
                    ChatflowMemoryVariable(
                        tenant_id=app_model.tenant_id,
                        app_id=app_model.id,
                        node_id=args['node_id'],
                        memory_id=args['id'],
                        name=memory_spec.name,
                        value=args['update'],
                        scope=memory_spec.scope,
                        term=memory_spec.term,
                    )
                )
            session.commit()
        return '', 204

api.add_resource(MemoryListApi, '/memories')
api.add_resource(MemoryEditApi, '/memory-edit')

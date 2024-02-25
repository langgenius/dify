import json
from datetime import datetime

from extensions.ext_database import db
from models.account import Account
from models.model import App, ChatbotAppEngine
from models.workflow import Workflow, WorkflowType
from services.workflow.defaults import default_block_configs
from services.workflow.workflow_converter import WorkflowConverter


class WorkflowService:
    """
    Workflow Service
    """

    def get_draft_workflow(self, app_model: App) -> Workflow:
        """
        Get draft workflow
        """
        # fetch draft workflow by app_model
        workflow = db.session.query(Workflow).filter(
            Workflow.tenant_id == app_model.tenant_id,
            Workflow.app_id == app_model.id,
            Workflow.version == 'draft'
        ).first()

        # return draft workflow
        return workflow

    def sync_draft_workflow(self, app_model: App, graph: dict, account: Account) -> Workflow:
        """
        Sync draft workflow
        """
        # fetch draft workflow by app_model
        workflow = self.get_draft_workflow(app_model=app_model)

        # create draft workflow if not found
        if not workflow:
            workflow = Workflow(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                type=WorkflowType.from_app_mode(app_model.mode).value,
                version='draft',
                graph=json.dumps(graph),
                created_by=account.id
            )
            db.session.add(workflow)
        # update draft workflow if found
        else:
            workflow.graph = json.dumps(graph)
            workflow.updated_by = account.id
            workflow.updated_at = datetime.utcnow()

        # commit db session changes
        db.session.commit()

        # return draft workflow
        return workflow

    def get_default_block_configs(self) -> dict:
        """
        Get default block configs
        """
        # return default block config
        return default_block_configs

    def chatbot_convert_to_workflow(self, app_model: App, account: Account) -> Workflow:
        """
        basic mode of chatbot app to workflow

        :param app_model: App instance
        :param account: Account instance
        :return:
        """
        # check if chatbot app is in basic mode
        if app_model.app_model_config.chatbot_app_engine != ChatbotAppEngine.NORMAL:
            raise ValueError('Chatbot app already in workflow mode')

        # convert to workflow mode
        workflow_converter = WorkflowConverter()
        workflow = workflow_converter.convert_to_workflow(app_model=app_model, account_id=account.id)

        return workflow

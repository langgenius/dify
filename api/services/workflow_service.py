import json
from datetime import datetime
from typing import Optional

from extensions.ext_database import db
from models.account import Account
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.workflow.defaults import default_block_configs
from services.workflow.workflow_converter import WorkflowConverter


class WorkflowService:
    """
    Workflow Service
    """

    def get_draft_workflow(self, app_model: App) -> Optional[Workflow]:
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

    def get_published_workflow(self, app_model: App) -> Optional[Workflow]:
        """
        Get published workflow
        """
        app_model_config = app_model.app_model_config

        if not app_model_config.workflow_id:
            return None

        # fetch published workflow by workflow_id
        workflow = db.session.query(Workflow).filter(
            Workflow.tenant_id == app_model.tenant_id,
            Workflow.app_id == app_model.id,
            Workflow.id == app_model_config.workflow_id
        ).first()

        # return published workflow
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

    def publish_workflow(self, app_model: App,
                         account: Account,
                         draft_workflow: Optional[Workflow] = None) -> Workflow:
        """
        Publish workflow from draft

        :param app_model: App instance
        :param account: Account instance
        :param draft_workflow: Workflow instance
        """
        if not draft_workflow:
            # fetch draft workflow by app_model
            draft_workflow = self.get_draft_workflow(app_model=app_model)

        if not draft_workflow:
            raise ValueError('No valid workflow found.')

        # TODO check if the workflow is valid, basic check

        # create new workflow
        workflow = Workflow(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type=draft_workflow.type,
            version=str(datetime.utcnow()),
            graph=draft_workflow.graph,
            created_by=account.id
        )

        # commit db session changes
        db.session.add(workflow)
        db.session.commit()

        app_model_config = app_model.app_model_config

        # create new app model config record
        new_app_model_config = app_model_config.copy()
        new_app_model_config.id = None
        new_app_model_config.app_id = app_model.id
        new_app_model_config.external_data_tools = ''
        new_app_model_config.model = ''
        new_app_model_config.user_input_form = ''
        new_app_model_config.dataset_query_variable = None
        new_app_model_config.pre_prompt = None
        new_app_model_config.agent_mode = ''
        new_app_model_config.prompt_type = 'simple'
        new_app_model_config.chat_prompt_config = ''
        new_app_model_config.completion_prompt_config = ''
        new_app_model_config.dataset_configs = ''
        new_app_model_config.workflow_id = workflow.id

        db.session.add(new_app_model_config)
        db.session.flush()

        app_model.app_model_config_id = new_app_model_config.id
        db.session.commit()

        # TODO update app related datasets

        # return new workflow
        return workflow

    def get_default_block_configs(self) -> dict:
        """
        Get default block configs
        """
        # return default block config
        return default_block_configs

    def convert_to_workflow(self, app_model: App, account: Account) -> App:
        """
        Basic mode of chatbot app(expert mode) to workflow
        Completion App to Workflow App

        :param app_model: App instance
        :param account: Account instance
        :return:
        """
        # chatbot convert to workflow mode
        workflow_converter = WorkflowConverter()

        if app_model.mode not in [AppMode.CHAT.value, AppMode.COMPLETION.value]:
            raise ValueError(f'Current App mode: {app_model.mode} is not supported convert to workflow.')

        # convert to workflow
        new_app = workflow_converter.convert_to_workflow(
            app_model=app_model,
            account=account
        )

        return new_app

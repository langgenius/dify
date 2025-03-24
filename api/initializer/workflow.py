import os
import yaml
import logging
import json

from sqlalchemy.exc import SQLAlchemyError
from services.app_dsl_service import AppDslService
from services.workflow_service import WorkflowService
from extensions.ext_database import db
from .decorator import initializer
from .admin import get_admin
from models import App, ApiToken, Workflow, InstalledApp
from contexts import tenant_id
from configs.app_config import APOConfig
from typing import Union
from sqlalchemy.dialects.postgresql import JSONB

@initializer(priority=3)
def init_workflow():
    apo_config = APOConfig()
    initial_language = apo_config.INITIAL_LANGUAGE
    workflow_dir = apo_config.WORKFLOW_DIR

    sub_dir = ''
    if initial_language == 'en-US':
        sub_dir = 'en'
    elif initial_language == 'zh-Hans':
        sub_dir = 'zh'
    workflows = []
    dir = f'{workflow_dir}/{sub_dir}'
    if not os.path.isdir(dir):
        logging.error(f"Invalid directory: {dir}")
        return

    for file_entry in os.scandir(dir):
        if not file_entry.name.endswith('.yaml') and not file_entry.name.endswith('.yml') or file_entry.name.startswith('.'):
            continue
        try:
            with open(file_entry.path, 'r', encoding='utf-8') as file:
                content = file.read()
                workflows.append(content)
        except Exception as e:
            logging.error(f"Failed to read file: {file_entry.path}")
    
    admin = get_admin()
    try:
        original_token = tenant_id.set(admin.current_tenant_id) 
        for w in workflows:
            result = _check_workflow_to_update(db.session, w, admin)
 
            if result is False:
                continue

            import_service = AppDslService(db.session)
            workflow_service = WorkflowService()
            
            '''Import an app or update existing app'''
            imp = import_service.import_app(
                account=admin,
                import_mode="yaml-content",
                yaml_content=w,
                app_id=result if result else None
            )

            app_model = (
                db.session.query(App)
                .filter(
                    App.id == imp.app_id,
                    App.tenant_id == admin.current_tenant_id,
                    App.status == "normal"
                )
                .first()
            )

            workflow_service.publish_workflow(app_model=app_model, account=admin)
            if result is None:
                _generate_api_key(db.session, imp.app_id, admin)
        db.session.commit()
        _adjust_workflows(initial_language)
    except Exception as e:
        db.session.rollback()
        raise
    finally:
        tenant_id.reset(original_token)

def _check_workflow_to_update(session, content, account) -> Union[str, bool, None]:
    """Check if the workflow needs to be updated or created.
    - None: Need to create a new App.
    - str(app_id): Need to update the existing App.
    - False: No need to update.
    """
    try:
        content_dict = yaml.safe_load(content)
        app_name = content_dict.get('app', {}).get('name')
        graph = json.dumps(
            content_dict.get('workflow', {}).get('graph'), 
            sort_keys=True)
        features = json.dumps(
            content_dict.get('workflow', {}).get('features'),
            sort_keys=True)
        
        app_model = (
            session.query(App)
            .filter(
                App.name == app_name,
                App.tenant_id == account.current_tenant_id,
                App.status == "normal",
            )
            .first()
        )

        if not app_model:
            return None

        workflows = (
            session.query(Workflow)
            .filter(Workflow.app_id == app_model.id)
            .all()
        )

        to_update = True

        for w in workflows:
            if graph == w.graph and features == w.features:
                to_update = False
                break
        
        if to_update:
            return app_model.id
        else:
            return False

    except Exception as e:
        logging.error(f"Failed to check workflow: {str(e)}")
        return False

def _generate_api_key(session, app_id, account, key=None):
    if not app_id or not account:
        return
    
    key = key or ApiToken.generate_api_key('app-', 24)
    api_token = ApiToken(
        app_id=app_id,
        tenant_id=account.current_tenant_id,
        token=key,
        type='app'
    )
    session.add(api_token)


def _adjust_workflows(language):
    to_adjust = {
        "zh-Hans": {
            "告警有效性分析": {
                "app_id": "dcfeddd2-d6e7-4dc4-a284-e48ab56bf6af",
                "api_token": "app-x0mOJKUvhr35BOISSeNmsfXj"
            },
            "告警简单根因分析": {
                "app_id": "a2d4d3aa-3401-4393-859e-df051bdd5cd1"
            }
        },
        "en-US": {
            "alert validity confirmation": {
                "app_id": "dcfeddd2-d6e7-4dc4-a284-e48ab56bf6af",
                "api_token": "app-x0mOJKUvhr35BOISSeNmsfXj"
            },
            "alert simple root cause analysis": {
                "app_id": "a2d4d3aa-3401-4393-859e-df051bdd5cd1"
            }
        }
    }
    try:
        config = to_adjust.get(language)
        for app_name, field_config in config.items():
                app = db.session.query(App).filter_by(name=app_name).first()
                new_app_id = field_config["app_id"]
                if not app:
                    continue
                
                if app.id == new_app_id:
                    continue

                origin_app_id = app.id
                update_mappings = [
                    (ApiToken, {"app_id": new_app_id}),
                    (Workflow, {"app_id": new_app_id}),
                    (InstalledApp, {"app_id": new_app_id})
                ]

                for model, update_values in update_mappings:
                    db.session.query(model)\
                        .filter_by(app_id=origin_app_id)\
                        .update(update_values, synchronize_session=False)

                app.id = new_app_id
                db.session.merge(app)

                if "api_token" in field_config:
                    new_token = field_config["api_token"]
                    db.session.query(ApiToken)\
                        .filter_by(app_id=new_app_id)\
                        .update({"token": new_token}, synchronize_session=False)

                db.session.commit()
                print(f"Successfully updated {app_name} (ID: {origin_app_id} → {new_app_id})")

    except SQLAlchemyError as e:
        db.session.rollback()
        logging.ERROR(f"Database error occurred: {str(e)}")
        raise
    except Exception as e:
        db.session.rollback()
        logging.ERROR(f"Unexpected error: {str(e)}")
        raise
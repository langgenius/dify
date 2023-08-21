import json
from functools import wraps

from flask_login import current_user
from core.login.login import login_required
from flask_restful import Resource
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from extensions.ext_database import db
from models.model import App, AppModelConfig


def universal_chat_app_required(view=None):
    def decorator(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            # get universal chat app
            universal_app = db.session.query(App).filter(
                App.tenant_id == current_user.current_tenant_id,
                App.is_universal == True
            ).first()

            if universal_app is None:
                # create universal app if not exists
                universal_app = App(
                    tenant_id=current_user.current_tenant_id,
                    name='Universal Chat',
                    mode='chat',
                    is_universal=True,
                    icon='',
                    icon_background='',
                    api_rpm=0,
                    api_rph=0,
                    enable_site=False,
                    enable_api=False,
                    status='normal'
                )

                db.session.add(universal_app)
                db.session.flush()

                app_model_config = AppModelConfig(
                    provider="",
                    model_id="",
                    configs={},
                    opening_statement='',
                    suggested_questions=json.dumps([]),
                    suggested_questions_after_answer=json.dumps({'enabled': True}),
                    speech_to_text=json.dumps({'enabled': True}),
                    more_like_this=None,
                    sensitive_word_avoidance=None,
                    model=json.dumps({
                        "provider": "openai",
                        "name": "gpt-3.5-turbo-16k",
                        "completion_params": {
                            "max_tokens": 800,
                            "temperature": 0.8,
                            "top_p": 1,
                            "presence_penalty": 0,
                            "frequency_penalty": 0
                        }
                    }),
                    user_input_form=json.dumps([]),
                    pre_prompt='',
                    agent_mode=json.dumps({"enabled": True, "strategy": "function_call", "tools": []}),
                )

                app_model_config.app_id = universal_app.id
                db.session.add(app_model_config)
                db.session.flush()

                universal_app.app_model_config_id = app_model_config.id
                db.session.commit()

            return view(universal_app, *args, **kwargs)
        return decorated

    if view:
        return decorator(view)
    return decorator


class UniversalChatResource(Resource):
    # must be reversed if there are multiple decorators
    method_decorators = [universal_chat_app_required, account_initialization_required, login_required, setup_required]

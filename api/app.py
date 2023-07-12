# -*- coding:utf-8 -*-
import os
from datetime import datetime

if not os.environ.get("DEBUG") or os.environ.get("DEBUG").lower() != 'true':
    from gevent import monkey
    monkey.patch_all()

import logging
import json
import threading

from flask import Flask, request, Response, session
import flask_login
from flask_cors import CORS

from extensions import ext_session, ext_celery, ext_sentry, ext_redis, ext_login, ext_migrate, \
    ext_database, ext_storage, ext_mail
from extensions.ext_database import db
from extensions.ext_login import login_manager

# DO NOT REMOVE BELOW
from models import model, account, dataset, web, task, source
from events import event_handlers
# DO NOT REMOVE ABOVE

import core
from config import Config, CloudEditionConfig
from commands import register_commands
from models.account import TenantAccountJoin
from models.model import Account, EndUser, App

import warnings
warnings.simplefilter("ignore", ResourceWarning)


class DifyApp(Flask):
    pass

# -------------
# Configuration
# -------------


config_type = os.getenv('EDITION', default='SELF_HOSTED')  # ce edition first

# ----------------------------
# Application Factory Function
# ----------------------------


def create_app(test_config=None) -> Flask:
    app = DifyApp(__name__)

    if test_config:
        app.config.from_object(test_config)
    else:
        if config_type == "CLOUD":
            app.config.from_object(CloudEditionConfig())
        else:
            app.config.from_object(Config())

    app.secret_key = app.config['SECRET_KEY']

    logging.basicConfig(level=app.config.get('LOG_LEVEL', 'INFO'))

    initialize_extensions(app)
    register_blueprints(app)
    register_commands(app)

    core.init_app(app)

    return app


def initialize_extensions(app):
    # Since the application instance is now created, pass it to each Flask
    # extension instance to bind it to the Flask application instance (app)
    ext_database.init_app(app)
    ext_migrate.init(app, db)
    ext_redis.init_app(app)
    ext_storage.init_app(app)
    ext_celery.init_app(app)
    ext_session.init_app(app)
    ext_login.init_app(app)
    ext_mail.init_app(app)
    ext_sentry.init_app(app)


# Flask-Login configuration
@login_manager.user_loader
def load_user(user_id):
    """Load user based on the user_id."""
    if request.blueprint == 'console':
        # Check if the user_id contains a dot, indicating the old format
        if '.' in user_id:
            tenant_id, account_id = user_id.split('.')
        else:
            account_id = user_id

        account = db.session.query(Account).filter(Account.id == account_id).first()

        if account:
            workspace_id = session.get('workspace_id')
            if workspace_id:
                tenant_account_join = db.session.query(TenantAccountJoin).filter(
                    TenantAccountJoin.account_id == account.id,
                    TenantAccountJoin.tenant_id == workspace_id
                ).first()

                if not tenant_account_join:
                    tenant_account_join = db.session.query(TenantAccountJoin).filter(
                        TenantAccountJoin.account_id == account.id).first()

                    if tenant_account_join:
                        account.current_tenant_id = tenant_account_join.tenant_id
                        session['workspace_id'] = account.current_tenant_id
                else:
                    account.current_tenant_id = workspace_id
            else:
                tenant_account_join = db.session.query(TenantAccountJoin).filter(
                    TenantAccountJoin.account_id == account.id).first()
                if tenant_account_join:
                    account.current_tenant_id = tenant_account_join.tenant_id
                    session['workspace_id'] = account.current_tenant_id

            account.last_active_at = datetime.utcnow()
            db.session.commit()

            # Log in the user with the updated user_id
            flask_login.login_user(account, remember=True)

        return account
    else:
        return None


@login_manager.unauthorized_handler
def unauthorized_handler():
    """Handle unauthorized requests."""
    return Response(json.dumps({
        'code': 'unauthorized',
        'message': "Unauthorized."
    }), status=401, content_type="application/json")


# register blueprint routers
def register_blueprints(app):
    from controllers.service_api import bp as service_api_bp
    from controllers.web import bp as web_bp
    from controllers.console import bp as console_app_bp

    CORS(service_api_bp,
         allow_headers=['Content-Type', 'Authorization', 'X-App-Code'],
         methods=['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'PATCH']
         )
    app.register_blueprint(service_api_bp)

    CORS(web_bp,
         resources={
             r"/*": {"origins": app.config['WEB_API_CORS_ALLOW_ORIGINS']}},
         supports_credentials=True,
         allow_headers=['Content-Type', 'Authorization', 'X-App-Code'],
         methods=['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'PATCH'],
         expose_headers=['X-Version', 'X-Env']
         )

    app.register_blueprint(web_bp)

    CORS(console_app_bp,
         resources={
             r"/*": {"origins": app.config['CONSOLE_CORS_ALLOW_ORIGINS']}},
         supports_credentials=True,
         allow_headers=['Content-Type', 'Authorization'],
         methods=['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'PATCH'],
         expose_headers=['X-Version', 'X-Env']
         )

    app.register_blueprint(console_app_bp)


# create app
app = create_app()
celery = app.extensions["celery"]


if app.config['TESTING']:
    print("App is running in TESTING mode")


@app.after_request
def after_request(response):
    """Add Version headers to the response."""
    response.headers.add('X-Version', app.config['CURRENT_VERSION'])
    response.headers.add('X-Env', app.config['DEPLOY_ENV'])
    return response


@app.route('/health')
def health():
    return Response(json.dumps({
        'status': 'ok',
        'version': app.config['CURRENT_VERSION']
    }), status=200, content_type="application/json")


@app.route('/threads')
def threads():
    num_threads = threading.active_count()
    threads = threading.enumerate()

    thread_list = []
    for thread in threads:
        thread_name = thread.name
        thread_id = thread.ident
        is_alive = thread.is_alive()

        thread_list.append({
            'name': thread_name,
            'id': thread_id,
            'is_alive': is_alive
        })

    return {
        'thread_num': num_threads,
        'threads': thread_list
    }


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)

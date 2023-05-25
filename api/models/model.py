import json

from flask import current_app, request
from flask_login import UserMixin
from sqlalchemy.dialects.postgresql import UUID

from libs.helper import generate_string
from extensions.ext_database import db
from .account import Account, Tenant


class DifySetup(db.Model):
    __tablename__ = 'dify_setups'
    __table_args__ = (
        db.PrimaryKeyConstraint('version', name='dify_setup_pkey'),
    )

    version = db.Column(db.String(255), nullable=False)
    setup_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))


class App(db.Model):
    __tablename__ = 'apps'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='app_pkey'),
        db.Index('app_tenant_id_idx', 'tenant_id')
    )

    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(UUID, nullable=False)
    name = db.Column(db.String(255), nullable=False)
    mode = db.Column(db.String(255), nullable=False)
    icon = db.Column(db.String(255))
    icon_background = db.Column(db.String(255))
    app_model_config_id = db.Column(UUID, nullable=True)
    status = db.Column(db.String(255), nullable=False, server_default=db.text("'normal'::character varying"))
    enable_site = db.Column(db.Boolean, nullable=False)
    enable_api = db.Column(db.Boolean, nullable=False)
    api_rpm = db.Column(db.Integer, nullable=False)
    api_rph = db.Column(db.Integer, nullable=False)
    is_demo = db.Column(db.Boolean, nullable=False, server_default=db.text('false'))
    is_public = db.Column(db.Boolean, nullable=False, server_default=db.text('false'))
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    @property
    def site(self):
        site = db.session.query(Site).filter(Site.app_id == self.id).first()
        return site

    @property
    def app_model_config(self):
        app_model_config = db.session.query(AppModelConfig).filter(
            AppModelConfig.id == self.app_model_config_id).first()
        return app_model_config

    @property
    def api_base_url(self):
        return (current_app.config['API_URL'] if current_app.config['API_URL'] else request.host_url.rstrip('/')) + '/v1'

    @property
    def tenant(self):
        tenant = db.session.query(Tenant).filter(Tenant.id == self.tenant_id).first()
        return tenant


class AppModelConfig(db.Model):
    __tablename__ = 'app_model_configs'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='app_model_config_pkey'),
        db.Index('app_app_id_idx', 'app_id')
    )

    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    app_id = db.Column(UUID, nullable=False)
    provider = db.Column(db.String(255), nullable=False)
    model_id = db.Column(db.String(255), nullable=False)
    configs = db.Column(db.JSON, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    opening_statement = db.Column(db.Text)
    suggested_questions = db.Column(db.Text)
    suggested_questions_after_answer = db.Column(db.Text)
    more_like_this = db.Column(db.Text)
    model = db.Column(db.Text)
    user_input_form = db.Column(db.Text)
    pre_prompt = db.Column(db.Text)
    agent_mode = db.Column(db.Text)

    @property
    def app(self):
        app = db.session.query(App).filter(App.id == self.app_id).first()
        return app

    @property
    def model_dict(self) -> dict:
        return json.loads(self.model) if self.model else None

    @property
    def suggested_questions_list(self) -> list:
        return json.loads(self.suggested_questions) if self.suggested_questions else []

    @property
    def suggested_questions_after_answer_dict(self) -> dict:
        return json.loads(self.suggested_questions_after_answer) if self.suggested_questions_after_answer \
            else {"enabled": False}

    @property
    def more_like_this_dict(self) -> dict:
        return json.loads(self.more_like_this) if self.more_like_this else {"enabled": False}

    @property
    def user_input_form_list(self) -> dict:
        return json.loads(self.user_input_form) if self.user_input_form else []

    @property
    def agent_mode_dict(self) -> dict:
        return json.loads(self.agent_mode) if self.agent_mode else {"enabled": False, "tools": []}


class RecommendedApp(db.Model):
    __tablename__ = 'recommended_apps'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='recommended_app_pkey'),
        db.Index('recommended_app_app_id_idx', 'app_id'),
        db.Index('recommended_app_is_listed_idx', 'is_listed', 'language')
    )

    id = db.Column(UUID, primary_key=True, server_default=db.text('uuid_generate_v4()'))
    app_id = db.Column(UUID, nullable=False)
    description = db.Column(db.JSON, nullable=False)
    copyright = db.Column(db.String(255), nullable=False)
    privacy_policy = db.Column(db.String(255), nullable=False)
    category = db.Column(db.String(255), nullable=False)
    position = db.Column(db.Integer, nullable=False, default=0)
    is_listed = db.Column(db.Boolean, nullable=False, default=True)
    install_count = db.Column(db.Integer, nullable=False, default=0)
    language = db.Column(db.String(255), nullable=False, server_default=db.text("'en-US'::character varying"))
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    @property
    def app(self):
        app = db.session.query(App).filter(App.id == self.app_id).first()
        return app


class InstalledApp(db.Model):
    __tablename__ = 'installed_apps'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='installed_app_pkey'),
        db.Index('installed_app_tenant_id_idx', 'tenant_id'),
        db.Index('installed_app_app_id_idx', 'app_id'),
        db.UniqueConstraint('tenant_id', 'app_id', name='unique_tenant_app')
    )

    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(UUID, nullable=False)
    app_id = db.Column(UUID, nullable=False)
    app_owner_tenant_id = db.Column(UUID, nullable=False)
    position = db.Column(db.Integer, nullable=False, default=0)
    is_pinned = db.Column(db.Boolean, nullable=False, server_default=db.text('false'))
    last_used_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    @property
    def app(self):
        app = db.session.query(App).filter(App.id == self.app_id).first()
        return app

    @property
    def tenant(self):
        tenant = db.session.query(Tenant).filter(Tenant.id == self.tenant_id).first()
        return tenant


class Conversation(db.Model):
    __tablename__ = 'conversations'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='conversation_pkey'),
        db.Index('conversation_app_from_user_idx', 'app_id', 'from_source', 'from_end_user_id')
    )

    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    app_id = db.Column(UUID, nullable=False)
    app_model_config_id = db.Column(UUID, nullable=False)
    model_provider = db.Column(db.String(255), nullable=False)
    override_model_configs = db.Column(db.Text)
    model_id = db.Column(db.String(255), nullable=False)
    mode = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    summary = db.Column(db.Text)
    inputs = db.Column(db.JSON)
    introduction = db.Column(db.Text)
    system_instruction = db.Column(db.Text)
    system_instruction_tokens = db.Column(db.Integer, nullable=False, server_default=db.text('0'))
    status = db.Column(db.String(255), nullable=False)
    from_source = db.Column(db.String(255), nullable=False)
    from_end_user_id = db.Column(UUID)
    from_account_id = db.Column(UUID)
    read_at = db.Column(db.DateTime)
    read_account_id = db.Column(UUID)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    messages = db.relationship("Message", backref="conversation", lazy='select', passive_deletes="all")
    message_annotations = db.relationship("MessageAnnotation", backref="conversation", lazy='select', passive_deletes="all")

    @property
    def model_config(self):
        model_config = {}
        if self.override_model_configs:
            override_model_configs = json.loads(self.override_model_configs)

            if 'model' in override_model_configs:
                model_config['model'] = override_model_configs['model']
                model_config['pre_prompt'] = override_model_configs['pre_prompt']
                model_config['agent_mode'] = override_model_configs['agent_mode']
                model_config['opening_statement'] = override_model_configs['opening_statement']
                model_config['suggested_questions'] = override_model_configs['suggested_questions']
                model_config['suggested_questions_after_answer'] = override_model_configs[
                    'suggested_questions_after_answer'] \
                    if 'suggested_questions_after_answer' in override_model_configs else {"enabled": False}
                model_config['more_like_this'] = override_model_configs['more_like_this'] \
                    if 'more_like_this' in override_model_configs else {"enabled": False}
                model_config['user_input_form'] = override_model_configs['user_input_form']
            else:
                model_config['configs'] = override_model_configs
        else:
            app_model_config = db.session.query(AppModelConfig).filter(
                AppModelConfig.id == self.app_model_config_id).first()

            model_config['configs'] = app_model_config.configs
            model_config['model'] = app_model_config.model_dict
            model_config['pre_prompt'] = app_model_config.pre_prompt
            model_config['agent_mode'] = app_model_config.agent_mode_dict
            model_config['opening_statement'] = app_model_config.opening_statement
            model_config['suggested_questions'] = app_model_config.suggested_questions_list
            model_config['suggested_questions_after_answer'] = app_model_config.suggested_questions_after_answer_dict
            model_config['more_like_this'] = app_model_config.more_like_this_dict
            model_config['user_input_form'] = app_model_config.user_input_form_list

        model_config['model_id'] = self.model_id
        model_config['provider'] = self.model_provider

        return model_config

    @property
    def summary_or_query(self):
        if self.summary:
            return self.summary
        else:
            first_message = self.first_message
            if first_message:
                return first_message.query
            else:
                return ''

    @property
    def annotated(self):
        return db.session.query(MessageAnnotation).filter(MessageAnnotation.conversation_id == self.id).count() > 0

    @property
    def annotation(self):
        return db.session.query(MessageAnnotation).filter(MessageAnnotation.conversation_id == self.id).first()

    @property
    def message_count(self):
        return db.session.query(Message).filter(Message.conversation_id == self.id).count()

    @property
    def user_feedback_stats(self):
        like = db.session.query(MessageFeedback) \
            .filter(MessageFeedback.conversation_id == self.id,
                    MessageFeedback.from_source == 'user',
                    MessageFeedback.rating == 'like').count()

        dislike = db.session.query(MessageFeedback) \
            .filter(MessageFeedback.conversation_id == self.id,
                    MessageFeedback.from_source == 'user',
                    MessageFeedback.rating == 'dislike').count()

        return {'like': like, 'dislike': dislike}

    @property
    def admin_feedback_stats(self):
        like = db.session.query(MessageFeedback) \
            .filter(MessageFeedback.conversation_id == self.id,
                    MessageFeedback.from_source == 'admin',
                    MessageFeedback.rating == 'like').count()

        dislike = db.session.query(MessageFeedback) \
            .filter(MessageFeedback.conversation_id == self.id,
                    MessageFeedback.from_source == 'admin',
                    MessageFeedback.rating == 'dislike').count()

        return {'like': like, 'dislike': dislike}

    @property
    def first_message(self):
        return db.session.query(Message).filter(Message.conversation_id == self.id).first()

    @property
    def app(self):
        return db.session.query(App).filter(App.id == self.app_id).first()


class Message(db.Model):
    __tablename__ = 'messages'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='message_pkey'),
        db.Index('message_app_id_idx', 'app_id', 'created_at'),
        db.Index('message_conversation_id_idx', 'conversation_id'),
        db.Index('message_end_user_idx', 'app_id', 'from_source', 'from_end_user_id'),
        db.Index('message_account_idx', 'app_id', 'from_source', 'from_account_id'),
    )

    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    app_id = db.Column(UUID, nullable=False)
    model_provider = db.Column(db.String(255), nullable=False)
    model_id = db.Column(db.String(255), nullable=False)
    override_model_configs = db.Column(db.Text)
    conversation_id = db.Column(UUID, db.ForeignKey('conversations.id'), nullable=False)
    inputs = db.Column(db.JSON)
    query = db.Column(db.Text, nullable=False)
    message = db.Column(db.JSON, nullable=False)
    message_tokens = db.Column(db.Integer, nullable=False, server_default=db.text('0'))
    message_unit_price = db.Column(db.Numeric(10, 4), nullable=False)
    answer = db.Column(db.Text, nullable=False)
    answer_tokens = db.Column(db.Integer, nullable=False, server_default=db.text('0'))
    answer_unit_price = db.Column(db.Numeric(10, 4), nullable=False)
    provider_response_latency = db.Column(db.Float, nullable=False, server_default=db.text('0'))
    total_price = db.Column(db.Numeric(10, 7))
    currency = db.Column(db.String(255), nullable=False)
    from_source = db.Column(db.String(255), nullable=False)
    from_end_user_id = db.Column(UUID)
    from_account_id = db.Column(UUID)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    agent_based = db.Column(db.Boolean, nullable=False, server_default=db.text('false'))

    @property
    def user_feedback(self):
        feedback = db.session.query(MessageFeedback).filter(MessageFeedback.message_id == self.id,
                                                            MessageFeedback.from_source == 'user').first()
        return feedback

    @property
    def admin_feedback(self):
        feedback = db.session.query(MessageFeedback).filter(MessageFeedback.message_id == self.id,
                                                            MessageFeedback.from_source == 'admin').first()
        return feedback

    @property
    def feedbacks(self):
        feedbacks = db.session.query(MessageFeedback).filter(MessageFeedback.message_id == self.id).all()
        return feedbacks

    @property
    def annotation(self):
        annotation = db.session.query(MessageAnnotation).filter(MessageAnnotation.message_id == self.id).first()
        return annotation

    @property
    def app_model_config(self):
        conversation = db.session.query(Conversation).filter(Conversation.id == self.conversation_id).first()
        if conversation:
            return db.session.query(AppModelConfig).filter(
                AppModelConfig.id == conversation.app_model_config_id).first()

        return None


class MessageFeedback(db.Model):
    __tablename__ = 'message_feedbacks'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='message_feedback_pkey'),
        db.Index('message_feedback_app_idx', 'app_id'),
        db.Index('message_feedback_message_idx', 'message_id', 'from_source'),
        db.Index('message_feedback_conversation_idx', 'conversation_id', 'from_source', 'rating')
    )

    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    app_id = db.Column(UUID, nullable=False)
    conversation_id = db.Column(UUID, nullable=False)
    message_id = db.Column(UUID, nullable=False)
    rating = db.Column(db.String(255), nullable=False)
    content = db.Column(db.Text)
    from_source = db.Column(db.String(255), nullable=False)
    from_end_user_id = db.Column(UUID)
    from_account_id = db.Column(UUID)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    @property
    def from_account(self):
        account = db.session.query(Account).filter(Account.id == self.from_account_id).first()
        return account


class MessageAnnotation(db.Model):
    __tablename__ = 'message_annotations'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='message_annotation_pkey'),
        db.Index('message_annotation_app_idx', 'app_id'),
        db.Index('message_annotation_conversation_idx', 'conversation_id'),
        db.Index('message_annotation_message_idx', 'message_id')
    )

    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    app_id = db.Column(UUID, nullable=False)
    conversation_id = db.Column(UUID, db.ForeignKey('conversations.id'), nullable=False)
    message_id = db.Column(UUID, nullable=False)
    content = db.Column(db.Text, nullable=False)
    account_id = db.Column(UUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    @property
    def account(self):
        account = db.session.query(Account).filter(Account.id == self.account_id).first()
        return account


class OperationLog(db.Model):
    __tablename__ = 'operation_logs'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='operation_log_pkey'),
        db.Index('operation_log_account_action_idx', 'tenant_id', 'account_id', 'action')
    )

    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(UUID, nullable=False)
    account_id = db.Column(UUID, nullable=False)
    action = db.Column(db.String(255), nullable=False)
    content = db.Column(db.JSON)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    created_ip = db.Column(db.String(255), nullable=False)
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))


class EndUser(UserMixin, db.Model):
    __tablename__ = 'end_users'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='end_user_pkey'),
        db.Index('end_user_session_id_idx', 'session_id', 'type'),
        db.Index('end_user_tenant_session_id_idx', 'tenant_id', 'session_id', 'type'),
    )

    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(UUID, nullable=False)
    app_id = db.Column(UUID, nullable=True)
    type = db.Column(db.String(255), nullable=False)
    external_user_id = db.Column(db.String(255), nullable=True)
    name = db.Column(db.String(255))
    is_anonymous = db.Column(db.Boolean, nullable=False, server_default=db.text('true'))
    session_id = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))


class Site(db.Model):
    __tablename__ = 'sites'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='site_pkey'),
        db.Index('site_app_id_idx', 'app_id'),
        db.Index('site_code_idx', 'code', 'status')
    )

    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    app_id = db.Column(UUID, nullable=False)
    title = db.Column(db.String(255), nullable=False)
    icon = db.Column(db.String(255))
    icon_background = db.Column(db.String(255))
    description = db.Column(db.String(255))
    default_language = db.Column(db.String(255), nullable=False)
    copyright = db.Column(db.String(255))
    privacy_policy = db.Column(db.String(255))
    customize_domain = db.Column(db.String(255))
    customize_token_strategy = db.Column(db.String(255), nullable=False)
    prompt_public = db.Column(db.Boolean, nullable=False, server_default=db.text('false'))
    status = db.Column(db.String(255), nullable=False, server_default=db.text("'normal'::character varying"))
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    code = db.Column(db.String(255))

    @staticmethod
    def generate_code(n):
        while True:
            result = generate_string(n)
            while db.session.query(Site).filter(Site.code == result).count() > 0:
                result = generate_string(n)

            return result

    @property
    def app_base_url(self):
        return (current_app.config['APP_URL'] if current_app.config['APP_URL'] else request.host_url.rstrip('/'))


class ApiToken(db.Model):
    __tablename__ = 'api_tokens'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='api_token_pkey'),
        db.Index('api_token_app_id_type_idx', 'app_id', 'type'),
        db.Index('api_token_token_idx', 'token', 'type')
    )

    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    app_id = db.Column(UUID, nullable=True)
    dataset_id = db.Column(UUID, nullable=True)
    type = db.Column(db.String(16), nullable=False)
    token = db.Column(db.String(255), nullable=False)
    last_used_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    @staticmethod
    def generate_api_key(prefix, n):
        while True:
            result = prefix + generate_string(n)
            while db.session.query(ApiToken).filter(ApiToken.token == result).count() > 0:
                result = prefix + generate_string(n)

            return result


class UploadFile(db.Model):
    __tablename__ = 'upload_files'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='upload_file_pkey'),
        db.Index('upload_file_tenant_idx', 'tenant_id')
    )

    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(UUID, nullable=False)
    storage_type = db.Column(db.String(255), nullable=False)
    key = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    size = db.Column(db.Integer, nullable=False)
    extension = db.Column(db.String(255), nullable=False)
    mime_type = db.Column(db.String(255), nullable=True)
    created_by = db.Column(UUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    used = db.Column(db.Boolean, nullable=False, server_default=db.text('false'))
    used_by = db.Column(UUID, nullable=True)
    used_at = db.Column(db.DateTime, nullable=True)
    hash = db.Column(db.String(255), nullable=True)


class ApiRequest(db.Model):
    __tablename__ = 'api_requests'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='api_request_pkey'),
        db.Index('api_request_token_idx', 'tenant_id', 'api_token_id')
    )

    id = db.Column(UUID, nullable=False, server_default=db.text('uuid_generate_v4()'))
    tenant_id = db.Column(UUID, nullable=False)
    api_token_id = db.Column(UUID, nullable=False)
    path = db.Column(db.String(255), nullable=False)
    request = db.Column(db.Text, nullable=True)
    response = db.Column(db.Text, nullable=True)
    ip = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))


class MessageChain(db.Model):
    __tablename__ = 'message_chains'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='message_chain_pkey'),
        db.Index('message_chain_message_id_idx', 'message_id')
    )

    id = db.Column(UUID, nullable=False, server_default=db.text('uuid_generate_v4()'))
    message_id = db.Column(UUID, nullable=False)
    type = db.Column(db.String(255), nullable=False)
    input = db.Column(db.Text, nullable=True)
    output = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.func.current_timestamp())


class MessageAgentThought(db.Model):
    __tablename__ = 'message_agent_thoughts'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='message_agent_thought_pkey'),
        db.Index('message_agent_thought_message_id_idx', 'message_id'),
        db.Index('message_agent_thought_message_chain_id_idx', 'message_chain_id'),
    )

    id = db.Column(UUID, nullable=False, server_default=db.text('uuid_generate_v4()'))
    message_id = db.Column(UUID, nullable=False)
    message_chain_id = db.Column(UUID, nullable=False)
    position = db.Column(db.Integer, nullable=False)
    thought = db.Column(db.Text, nullable=True)
    tool = db.Column(db.Text, nullable=True)
    tool_input = db.Column(db.Text, nullable=True)
    observation = db.Column(db.Text, nullable=True)
    # plugin_id = db.Column(UUID, nullable=True)  ## for future design
    tool_process_data = db.Column(db.Text, nullable=True)
    message = db.Column(db.Text, nullable=True)
    message_token = db.Column(db.Integer, nullable=True)
    message_unit_price = db.Column(db.Numeric, nullable=True)
    answer = db.Column(db.Text, nullable=True)
    answer_token = db.Column(db.Integer, nullable=True)
    answer_unit_price = db.Column(db.Numeric, nullable=True)
    tokens = db.Column(db.Integer, nullable=True)
    total_price = db.Column(db.Numeric, nullable=True)
    currency = db.Column(db.String, nullable=True)
    latency = db.Column(db.Float, nullable=True)
    created_by_role = db.Column(db.String, nullable=False)
    created_by = db.Column(UUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.func.current_timestamp())

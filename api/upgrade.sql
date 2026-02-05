BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 64b051264f32

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";;

CREATE TABLE account_integrates (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    account_id UUID NOT NULL, 
    provider VARCHAR(16) NOT NULL, 
    open_id VARCHAR(255) NOT NULL, 
    encrypted_token VARCHAR(255) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT account_integrate_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_account_provider UNIQUE (account_id, provider), 
    CONSTRAINT unique_provider_open_id UNIQUE (provider, open_id)
);

CREATE TABLE accounts (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    email VARCHAR(255) NOT NULL, 
    password VARCHAR(255), 
    password_salt VARCHAR(255), 
    avatar VARCHAR(255), 
    interface_language VARCHAR(255), 
    interface_theme VARCHAR(255), 
    timezone VARCHAR(255), 
    last_login_at TIMESTAMP WITHOUT TIME ZONE, 
    last_login_ip VARCHAR(255), 
    status VARCHAR(16) DEFAULT 'active'::character varying NOT NULL, 
    initialized_at TIMESTAMP WITHOUT TIME ZONE, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT account_pkey PRIMARY KEY (id)
);

CREATE INDEX account_email_idx ON accounts (email);

CREATE TABLE api_requests (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    api_token_id UUID NOT NULL, 
    path VARCHAR(255) NOT NULL, 
    request TEXT, 
    response TEXT, 
    ip VARCHAR(255) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT api_request_pkey PRIMARY KEY (id)
);

CREATE INDEX api_request_token_idx ON api_requests (tenant_id, api_token_id);

CREATE TABLE api_tokens (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID, 
    dataset_id UUID, 
    type VARCHAR(16) NOT NULL, 
    token VARCHAR(255) NOT NULL, 
    last_used_at TIMESTAMP WITHOUT TIME ZONE, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT api_token_pkey PRIMARY KEY (id)
);

CREATE INDEX api_token_app_id_type_idx ON api_tokens (app_id, type);

CREATE INDEX api_token_token_idx ON api_tokens (token, type);

CREATE TABLE app_dataset_joins (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    dataset_id UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT app_dataset_join_pkey PRIMARY KEY (id)
);

CREATE INDEX app_dataset_join_app_dataset_idx ON app_dataset_joins (dataset_id, app_id);

CREATE TABLE app_model_configs (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    provider VARCHAR(255) NOT NULL, 
    model_id VARCHAR(255) NOT NULL, 
    configs JSON NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    opening_statement TEXT, 
    suggested_questions TEXT, 
    suggested_questions_after_answer TEXT, 
    more_like_this TEXT, 
    model TEXT, 
    user_input_form TEXT, 
    pre_prompt TEXT, 
    agent_mode TEXT, 
    CONSTRAINT app_model_config_pkey PRIMARY KEY (id)
);

CREATE INDEX app_app_id_idx ON app_model_configs (app_id);

CREATE TABLE apps (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    mode VARCHAR(255) NOT NULL, 
    icon VARCHAR(255), 
    icon_background VARCHAR(255), 
    app_model_config_id UUID, 
    status VARCHAR(255) DEFAULT 'normal'::character varying NOT NULL, 
    enable_site BOOLEAN NOT NULL, 
    enable_api BOOLEAN NOT NULL, 
    api_rpm INTEGER NOT NULL, 
    api_rph INTEGER NOT NULL, 
    is_demo BOOLEAN DEFAULT false NOT NULL, 
    is_public BOOLEAN DEFAULT false NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT app_pkey PRIMARY KEY (id)
);

CREATE INDEX app_tenant_id_idx ON apps (tenant_id);

CREATE SEQUENCE task_id_sequence;;

CREATE SEQUENCE taskset_id_sequence;;

CREATE TABLE celery_taskmeta (
    id INTEGER DEFAULT nextval('task_id_sequence') NOT NULL, 
    task_id VARCHAR(155), 
    status VARCHAR(50), 
    result BYTEA, 
    date_done TIMESTAMP WITHOUT TIME ZONE, 
    traceback TEXT, 
    name VARCHAR(155), 
    args BYTEA, 
    kwargs BYTEA, 
    worker VARCHAR(155), 
    retries INTEGER, 
    queue VARCHAR(155), 
    CONSTRAINT celery_taskmeta_pkey PRIMARY KEY (id), 
    CONSTRAINT celery_taskmeta_task_id_key UNIQUE (task_id)
);

CREATE TABLE celery_tasksetmeta (
    id INTEGER DEFAULT nextval('taskset_id_sequence') NOT NULL, 
    taskset_id VARCHAR(155), 
    result BYTEA, 
    date_done TIMESTAMP WITHOUT TIME ZONE, 
    CONSTRAINT celery_tasksetmeta_pkey PRIMARY KEY (id), 
    CONSTRAINT celery_tasksetmeta_taskset_id_key UNIQUE (taskset_id)
);

CREATE TABLE conversations (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    app_model_config_id UUID NOT NULL, 
    model_provider VARCHAR(255) NOT NULL, 
    override_model_configs TEXT, 
    model_id VARCHAR(255) NOT NULL, 
    mode VARCHAR(255) NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    summary TEXT, 
    inputs JSON, 
    introduction TEXT, 
    system_instruction TEXT, 
    system_instruction_tokens INTEGER DEFAULT 0 NOT NULL, 
    status VARCHAR(255) NOT NULL, 
    from_source VARCHAR(255) NOT NULL, 
    from_end_user_id UUID, 
    from_account_id UUID, 
    read_at TIMESTAMP WITHOUT TIME ZONE, 
    read_account_id UUID, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT conversation_pkey PRIMARY KEY (id)
);

CREATE INDEX conversation_app_from_user_idx ON conversations (app_id, from_source, from_end_user_id);

CREATE TABLE dataset_keyword_tables (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    dataset_id UUID NOT NULL, 
    keyword_table TEXT NOT NULL, 
    CONSTRAINT dataset_keyword_table_pkey PRIMARY KEY (id), 
    CONSTRAINT dataset_keyword_tables_dataset_id_key UNIQUE (dataset_id)
);

CREATE INDEX dataset_keyword_table_dataset_id_idx ON dataset_keyword_tables (dataset_id);

CREATE TABLE dataset_process_rules (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    dataset_id UUID NOT NULL, 
    mode VARCHAR(255) DEFAULT 'automatic'::character varying NOT NULL, 
    rules TEXT, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT dataset_process_rule_pkey PRIMARY KEY (id)
);

CREATE INDEX dataset_process_rule_dataset_id_idx ON dataset_process_rules (dataset_id);

CREATE TABLE dataset_queries (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    dataset_id UUID NOT NULL, 
    content TEXT NOT NULL, 
    source VARCHAR(255) NOT NULL, 
    source_app_id UUID, 
    created_by_role VARCHAR NOT NULL, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT dataset_query_pkey PRIMARY KEY (id)
);

CREATE INDEX dataset_query_dataset_id_idx ON dataset_queries (dataset_id);

CREATE TABLE datasets (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    description TEXT, 
    provider VARCHAR(255) DEFAULT 'vendor'::character varying NOT NULL, 
    permission VARCHAR(255) DEFAULT 'only_me'::character varying NOT NULL, 
    data_source_type VARCHAR(255), 
    indexing_technique VARCHAR(255), 
    index_struct TEXT, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_by UUID, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT dataset_pkey PRIMARY KEY (id)
);

CREATE INDEX dataset_tenant_idx ON datasets (tenant_id);

CREATE TABLE dify_setups (
    version VARCHAR(255) NOT NULL, 
    setup_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT dify_setup_pkey PRIMARY KEY (version)
);

CREATE TABLE document_segments (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    dataset_id UUID NOT NULL, 
    document_id UUID NOT NULL, 
    position INTEGER NOT NULL, 
    content TEXT NOT NULL, 
    word_count INTEGER NOT NULL, 
    tokens INTEGER NOT NULL, 
    keywords JSON, 
    index_node_id VARCHAR(255), 
    index_node_hash VARCHAR(255), 
    hit_count INTEGER NOT NULL, 
    enabled BOOLEAN DEFAULT true NOT NULL, 
    disabled_at TIMESTAMP WITHOUT TIME ZONE, 
    disabled_by UUID, 
    status VARCHAR(255) DEFAULT 'waiting'::character varying NOT NULL, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    indexing_at TIMESTAMP WITHOUT TIME ZONE, 
    completed_at TIMESTAMP WITHOUT TIME ZONE, 
    error TEXT, 
    stopped_at TIMESTAMP WITHOUT TIME ZONE, 
    CONSTRAINT document_segment_pkey PRIMARY KEY (id)
);

CREATE INDEX document_segment_dataset_id_idx ON document_segments (dataset_id);

CREATE INDEX document_segment_dataset_node_idx ON document_segments (dataset_id, index_node_id);

CREATE INDEX document_segment_document_id_idx ON document_segments (document_id);

CREATE INDEX document_segment_tenant_dataset_idx ON document_segments (dataset_id, tenant_id);

CREATE INDEX document_segment_tenant_document_idx ON document_segments (document_id, tenant_id);

CREATE TABLE documents (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    dataset_id UUID NOT NULL, 
    position INTEGER NOT NULL, 
    data_source_type VARCHAR(255) NOT NULL, 
    data_source_info TEXT, 
    dataset_process_rule_id UUID, 
    batch VARCHAR(255) NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    created_from VARCHAR(255) NOT NULL, 
    created_by UUID NOT NULL, 
    created_api_request_id UUID, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    processing_started_at TIMESTAMP WITHOUT TIME ZONE, 
    file_id TEXT, 
    word_count INTEGER, 
    parsing_completed_at TIMESTAMP WITHOUT TIME ZONE, 
    cleaning_completed_at TIMESTAMP WITHOUT TIME ZONE, 
    splitting_completed_at TIMESTAMP WITHOUT TIME ZONE, 
    tokens INTEGER, 
    indexing_latency FLOAT, 
    completed_at TIMESTAMP WITHOUT TIME ZONE, 
    is_paused BOOLEAN DEFAULT false, 
    paused_by UUID, 
    paused_at TIMESTAMP WITHOUT TIME ZONE, 
    error TEXT, 
    stopped_at TIMESTAMP WITHOUT TIME ZONE, 
    indexing_status VARCHAR(255) DEFAULT 'waiting'::character varying NOT NULL, 
    enabled BOOLEAN DEFAULT true NOT NULL, 
    disabled_at TIMESTAMP WITHOUT TIME ZONE, 
    disabled_by UUID, 
    archived BOOLEAN DEFAULT false NOT NULL, 
    archived_reason VARCHAR(255), 
    archived_by UUID, 
    archived_at TIMESTAMP WITHOUT TIME ZONE, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    doc_type VARCHAR(40), 
    doc_metadata JSON, 
    CONSTRAINT document_pkey PRIMARY KEY (id)
);

CREATE INDEX document_dataset_id_idx ON documents (dataset_id);

CREATE INDEX document_is_paused_idx ON documents (is_paused);

CREATE TABLE embeddings (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    hash VARCHAR(64) NOT NULL, 
    embedding BYTEA NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT embedding_pkey PRIMARY KEY (id), 
    CONSTRAINT embedding_hash_idx UNIQUE (hash)
);

CREATE TABLE end_users (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    app_id UUID, 
    type VARCHAR(255) NOT NULL, 
    external_user_id VARCHAR(255), 
    name VARCHAR(255), 
    is_anonymous BOOLEAN DEFAULT true NOT NULL, 
    session_id VARCHAR(255) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT end_user_pkey PRIMARY KEY (id)
);

CREATE INDEX end_user_session_id_idx ON end_users (session_id, type);

CREATE INDEX end_user_tenant_session_id_idx ON end_users (tenant_id, session_id, type);

CREATE TABLE installed_apps (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    app_id UUID NOT NULL, 
    app_owner_tenant_id UUID NOT NULL, 
    position INTEGER NOT NULL, 
    is_pinned BOOLEAN DEFAULT false NOT NULL, 
    last_used_at TIMESTAMP WITHOUT TIME ZONE, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT installed_app_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_tenant_app UNIQUE (tenant_id, app_id)
);

CREATE INDEX installed_app_app_id_idx ON installed_apps (app_id);

CREATE INDEX installed_app_tenant_id_idx ON installed_apps (tenant_id);

CREATE TABLE invitation_codes (
    id SERIAL NOT NULL, 
    batch VARCHAR(255) NOT NULL, 
    code VARCHAR(32) NOT NULL, 
    status VARCHAR(16) DEFAULT 'unused'::character varying NOT NULL, 
    used_at TIMESTAMP WITHOUT TIME ZONE, 
    used_by_tenant_id UUID, 
    used_by_account_id UUID, 
    deprecated_at TIMESTAMP WITHOUT TIME ZONE, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT invitation_code_pkey PRIMARY KEY (id)
);

CREATE INDEX invitation_codes_batch_idx ON invitation_codes (batch);

CREATE INDEX invitation_codes_code_idx ON invitation_codes (code, status);

CREATE TABLE message_agent_thoughts (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    message_id UUID NOT NULL, 
    message_chain_id UUID NOT NULL, 
    position INTEGER NOT NULL, 
    thought TEXT, 
    tool TEXT, 
    tool_input TEXT, 
    observation TEXT, 
    tool_process_data TEXT, 
    message TEXT, 
    message_token INTEGER, 
    message_unit_price NUMERIC, 
    answer TEXT, 
    answer_token INTEGER, 
    answer_unit_price NUMERIC, 
    tokens INTEGER, 
    total_price NUMERIC, 
    currency VARCHAR, 
    latency FLOAT, 
    created_by_role VARCHAR NOT NULL, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT message_agent_thought_pkey PRIMARY KEY (id)
);

CREATE INDEX message_agent_thought_message_chain_id_idx ON message_agent_thoughts (message_chain_id);

CREATE INDEX message_agent_thought_message_id_idx ON message_agent_thoughts (message_id);

CREATE TABLE message_chains (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    message_id UUID NOT NULL, 
    type VARCHAR(255) NOT NULL, 
    input TEXT, 
    output TEXT, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT message_chain_pkey PRIMARY KEY (id)
);

CREATE INDEX message_chain_message_id_idx ON message_chains (message_id);

CREATE TABLE message_feedbacks (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    conversation_id UUID NOT NULL, 
    message_id UUID NOT NULL, 
    rating VARCHAR(255) NOT NULL, 
    content TEXT, 
    from_source VARCHAR(255) NOT NULL, 
    from_end_user_id UUID, 
    from_account_id UUID, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT message_feedback_pkey PRIMARY KEY (id)
);

CREATE INDEX message_feedback_app_idx ON message_feedbacks (app_id);

CREATE INDEX message_feedback_conversation_idx ON message_feedbacks (conversation_id, from_source, rating);

CREATE INDEX message_feedback_message_idx ON message_feedbacks (message_id, from_source);

CREATE TABLE operation_logs (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    account_id UUID NOT NULL, 
    action VARCHAR(255) NOT NULL, 
    content JSON, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    created_ip VARCHAR(255) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT operation_log_pkey PRIMARY KEY (id)
);

CREATE INDEX operation_log_account_action_idx ON operation_logs (tenant_id, account_id, action);

CREATE TABLE pinned_conversations (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    conversation_id UUID NOT NULL, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT pinned_conversation_pkey PRIMARY KEY (id)
);

CREATE INDEX pinned_conversation_conversation_idx ON pinned_conversations (app_id, conversation_id, created_by);

CREATE TABLE providers (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    provider_name VARCHAR(40) NOT NULL, 
    provider_type VARCHAR(40) DEFAULT 'custom'::character varying NOT NULL, 
    encrypted_config TEXT, 
    is_valid BOOLEAN DEFAULT false NOT NULL, 
    last_used TIMESTAMP WITHOUT TIME ZONE, 
    quota_type VARCHAR(40) DEFAULT ''::character varying, 
    quota_limit INTEGER, 
    quota_used INTEGER, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT provider_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_provider_name_type_quota UNIQUE (tenant_id, provider_name, provider_type, quota_type)
);

CREATE INDEX provider_tenant_id_provider_idx ON providers (tenant_id, provider_name);

CREATE TABLE recommended_apps (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    description JSON NOT NULL, 
    copyright VARCHAR(255) NOT NULL, 
    privacy_policy VARCHAR(255) NOT NULL, 
    category VARCHAR(255) NOT NULL, 
    position INTEGER NOT NULL, 
    is_listed BOOLEAN NOT NULL, 
    install_count INTEGER NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT recommended_app_pkey PRIMARY KEY (id)
);

CREATE INDEX recommended_app_app_id_idx ON recommended_apps (app_id);

CREATE INDEX recommended_app_is_listed_idx ON recommended_apps (is_listed);

CREATE TABLE saved_messages (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    message_id UUID NOT NULL, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT saved_message_pkey PRIMARY KEY (id)
);

CREATE INDEX saved_message_message_idx ON saved_messages (app_id, message_id, created_by);

CREATE TABLE sessions (
    id SERIAL NOT NULL, 
    session_id VARCHAR(255), 
    data BYTEA, 
    expiry TIMESTAMP WITHOUT TIME ZONE, 
    CONSTRAINT sessions_pkey PRIMARY KEY (id), 
    CONSTRAINT sessions_session_id_key UNIQUE (session_id)
);

CREATE TABLE sites (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    title VARCHAR(255) NOT NULL, 
    icon VARCHAR(255), 
    icon_background VARCHAR(255), 
    description VARCHAR(255), 
    default_language VARCHAR(255) NOT NULL, 
    copyright VARCHAR(255), 
    privacy_policy VARCHAR(255), 
    customize_domain VARCHAR(255), 
    customize_token_strategy VARCHAR(255) NOT NULL, 
    prompt_public BOOLEAN DEFAULT false NOT NULL, 
    status VARCHAR(255) DEFAULT 'normal'::character varying NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    code VARCHAR(255), 
    CONSTRAINT site_pkey PRIMARY KEY (id)
);

CREATE INDEX site_app_id_idx ON sites (app_id);

CREATE INDEX site_code_idx ON sites (code, status);

CREATE TABLE tenant_account_joins (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    account_id UUID NOT NULL, 
    role VARCHAR(16) DEFAULT 'normal' NOT NULL, 
    invited_by UUID, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT tenant_account_join_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_tenant_account_join UNIQUE (tenant_id, account_id)
);

CREATE INDEX tenant_account_join_account_id_idx ON tenant_account_joins (account_id);

CREATE INDEX tenant_account_join_tenant_id_idx ON tenant_account_joins (tenant_id);

CREATE TABLE tenants (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    encrypt_public_key TEXT, 
    plan VARCHAR(255) DEFAULT 'basic'::character varying NOT NULL, 
    status VARCHAR(255) DEFAULT 'normal'::character varying NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT tenant_pkey PRIMARY KEY (id)
);

CREATE TABLE upload_files (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    storage_type VARCHAR(255) NOT NULL, 
    key VARCHAR(255) NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    size INTEGER NOT NULL, 
    extension VARCHAR(255) NOT NULL, 
    mime_type VARCHAR(255), 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    used BOOLEAN DEFAULT false NOT NULL, 
    used_by UUID, 
    used_at TIMESTAMP WITHOUT TIME ZONE, 
    hash VARCHAR(255), 
    CONSTRAINT upload_file_pkey PRIMARY KEY (id)
);

CREATE INDEX upload_file_tenant_idx ON upload_files (tenant_id);

CREATE TABLE message_annotations (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    conversation_id UUID NOT NULL, 
    message_id UUID NOT NULL, 
    content TEXT NOT NULL, 
    account_id UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT message_annotation_pkey PRIMARY KEY (id)
);

CREATE INDEX message_annotation_app_idx ON message_annotations (app_id);

CREATE INDEX message_annotation_conversation_idx ON message_annotations (conversation_id);

CREATE INDEX message_annotation_message_idx ON message_annotations (message_id);

CREATE TABLE messages (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    model_provider VARCHAR(255) NOT NULL, 
    model_id VARCHAR(255) NOT NULL, 
    override_model_configs TEXT, 
    conversation_id UUID NOT NULL, 
    inputs JSON, 
    query TEXT NOT NULL, 
    message JSON NOT NULL, 
    message_tokens INTEGER DEFAULT 0 NOT NULL, 
    message_unit_price NUMERIC(10, 4) NOT NULL, 
    answer TEXT NOT NULL, 
    answer_tokens INTEGER DEFAULT 0 NOT NULL, 
    answer_unit_price NUMERIC(10, 4) NOT NULL, 
    provider_response_latency FLOAT DEFAULT 0 NOT NULL, 
    total_price NUMERIC(10, 7), 
    currency VARCHAR(255) NOT NULL, 
    from_source VARCHAR(255) NOT NULL, 
    from_end_user_id UUID, 
    from_account_id UUID, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    agent_based BOOLEAN DEFAULT false NOT NULL, 
    CONSTRAINT message_pkey PRIMARY KEY (id)
);

CREATE INDEX message_account_idx ON messages (app_id, from_source, from_account_id);

CREATE INDEX message_app_id_idx ON messages (app_id, created_at);

CREATE INDEX message_conversation_id_idx ON messages (conversation_id);

CREATE INDEX message_end_user_idx ON messages (app_id, from_source, from_end_user_id);

INSERT INTO alembic_version (version_num) VALUES ('64b051264f32') RETURNING alembic_version.version_num;

-- Running upgrade 64b051264f32 -> 9f4e3427ea84

ALTER TABLE pinned_conversations ADD COLUMN created_by_role VARCHAR(255) DEFAULT 'end_user'::character varying NOT NULL;

DROP INDEX pinned_conversation_conversation_idx;

CREATE INDEX pinned_conversation_conversation_idx ON pinned_conversations (app_id, conversation_id, created_by_role, created_by);

ALTER TABLE saved_messages ADD COLUMN created_by_role VARCHAR(255) DEFAULT 'end_user'::character varying NOT NULL;

DROP INDEX saved_message_message_idx;

CREATE INDEX saved_message_message_idx ON saved_messages (app_id, message_id, created_by_role, created_by);

UPDATE alembic_version SET version_num='9f4e3427ea84' WHERE alembic_version.version_num = '64b051264f32';

-- Running upgrade 9f4e3427ea84 -> a45f4dfde53b

ALTER TABLE recommended_apps ADD COLUMN language VARCHAR(255) DEFAULT 'en-US'::character varying NOT NULL;

DROP INDEX recommended_app_is_listed_idx;

CREATE INDEX recommended_app_is_listed_idx ON recommended_apps (is_listed, language);

UPDATE alembic_version SET version_num='a45f4dfde53b' WHERE alembic_version.version_num = '9f4e3427ea84';

-- Running upgrade a45f4dfde53b -> 614f77cecc48

ALTER TABLE accounts ADD COLUMN last_active_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL;

UPDATE alembic_version SET version_num='614f77cecc48' WHERE alembic_version.version_num = 'a45f4dfde53b';

-- Running upgrade 614f77cecc48 -> e32f6ccb87c6

CREATE TABLE data_source_bindings (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    access_token VARCHAR(255) NOT NULL, 
    provider VARCHAR(255) NOT NULL, 
    source_info JSONB NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    disabled BOOLEAN DEFAULT false, 
    CONSTRAINT source_binding_pkey PRIMARY KEY (id)
);

CREATE INDEX source_binding_tenant_id_idx ON data_source_bindings (tenant_id);

CREATE INDEX source_info_idx ON data_source_bindings USING gin (source_info);

UPDATE alembic_version SET version_num='e32f6ccb87c6' WHERE alembic_version.version_num = '614f77cecc48';

-- Running upgrade e32f6ccb87c6 -> d3d503a3471c

ALTER TABLE conversations ADD COLUMN is_deleted BOOLEAN DEFAULT false NOT NULL;

UPDATE alembic_version SET version_num='d3d503a3471c' WHERE alembic_version.version_num = 'e32f6ccb87c6';

-- Running upgrade d3d503a3471c -> a5b56fb053ef

ALTER TABLE app_model_configs ADD COLUMN speech_to_text TEXT;

UPDATE alembic_version SET version_num='a5b56fb053ef' WHERE alembic_version.version_num = 'd3d503a3471c';

-- Running upgrade a5b56fb053ef -> 2beac44e5f5f

ALTER TABLE apps ADD COLUMN is_universal BOOLEAN DEFAULT false NOT NULL;

UPDATE alembic_version SET version_num='2beac44e5f5f' WHERE alembic_version.version_num = 'a5b56fb053ef';

-- Running upgrade 2beac44e5f5f -> 7ce5a52e4eee

CREATE TABLE tool_providers (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    tool_name VARCHAR(40) NOT NULL, 
    encrypted_credentials TEXT, 
    is_enabled BOOLEAN DEFAULT false NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT tool_provider_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_tool_provider_tool_name UNIQUE (tenant_id, tool_name)
);

ALTER TABLE app_model_configs ADD COLUMN sensitive_word_avoidance TEXT;

UPDATE alembic_version SET version_num='7ce5a52e4eee' WHERE alembic_version.version_num = '2beac44e5f5f';

-- Running upgrade 7ce5a52e4eee -> 8d2d099ceb74

ALTER TABLE document_segments ADD COLUMN answer TEXT;

ALTER TABLE document_segments ADD COLUMN updated_by UUID;

ALTER TABLE document_segments ADD COLUMN updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL;

ALTER TABLE documents ADD COLUMN doc_form VARCHAR(255) DEFAULT 'text_model'::character varying NOT NULL;

UPDATE alembic_version SET version_num='8d2d099ceb74' WHERE alembic_version.version_num = '7ce5a52e4eee';

-- Running upgrade 8d2d099ceb74 -> 16fa53d9faec

CREATE TABLE provider_models (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    provider_name VARCHAR(40) NOT NULL, 
    model_name VARCHAR(40) NOT NULL, 
    model_type VARCHAR(40) NOT NULL, 
    encrypted_config TEXT, 
    is_valid BOOLEAN DEFAULT false NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT provider_model_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_provider_model_name UNIQUE (tenant_id, provider_name, model_name, model_type)
);

CREATE INDEX provider_model_tenant_id_provider_idx ON provider_models (tenant_id, provider_name);

CREATE TABLE tenant_default_models (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    provider_name VARCHAR(40) NOT NULL, 
    model_name VARCHAR(40) NOT NULL, 
    model_type VARCHAR(40) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT tenant_default_model_pkey PRIMARY KEY (id)
);

CREATE INDEX tenant_default_model_tenant_id_provider_type_idx ON tenant_default_models (tenant_id, provider_name, model_type);

CREATE TABLE tenant_preferred_model_providers (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    provider_name VARCHAR(40) NOT NULL, 
    preferred_provider_type VARCHAR(40) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT tenant_preferred_model_provider_pkey PRIMARY KEY (id)
);

CREATE INDEX tenant_preferred_model_provider_tenant_provider_idx ON tenant_preferred_model_providers (tenant_id, provider_name);

UPDATE alembic_version SET version_num='16fa53d9faec' WHERE alembic_version.version_num = '8d2d099ceb74';

-- Running upgrade 16fa53d9faec -> e35ed59becda

ALTER TABLE providers ALTER COLUMN quota_limit TYPE BIGINT;

ALTER TABLE providers ALTER COLUMN quota_used TYPE BIGINT;

UPDATE alembic_version SET version_num='e35ed59becda' WHERE alembic_version.version_num = '16fa53d9faec';

-- Running upgrade e35ed59becda -> bf0aec5ba2cf

CREATE TABLE provider_orders (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    provider_name VARCHAR(40) NOT NULL, 
    account_id UUID NOT NULL, 
    payment_product_id VARCHAR(191) NOT NULL, 
    payment_id VARCHAR(191), 
    transaction_id VARCHAR(191), 
    quantity INTEGER DEFAULT 1 NOT NULL, 
    currency VARCHAR(40), 
    total_amount INTEGER, 
    payment_status VARCHAR(40) DEFAULT 'wait_pay'::character varying NOT NULL, 
    paid_at TIMESTAMP WITHOUT TIME ZONE, 
    pay_failed_at TIMESTAMP WITHOUT TIME ZONE, 
    refunded_at TIMESTAMP WITHOUT TIME ZONE, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT provider_order_pkey PRIMARY KEY (id)
);

CREATE INDEX provider_order_tenant_provider_idx ON provider_orders (tenant_id, provider_name);

UPDATE alembic_version SET version_num='bf0aec5ba2cf' WHERE alembic_version.version_num = 'e35ed59becda';

-- Running upgrade bf0aec5ba2cf -> 5022897aaceb

ALTER TABLE embeddings ADD COLUMN model_name VARCHAR(40) DEFAULT 'text-embedding-ada-002'::character varying NOT NULL;

ALTER TABLE embeddings DROP CONSTRAINT embedding_hash_idx;

ALTER TABLE embeddings ADD CONSTRAINT embedding_hash_idx UNIQUE (model_name, hash);

UPDATE alembic_version SET version_num='5022897aaceb' WHERE alembic_version.version_num = 'bf0aec5ba2cf';

-- Running upgrade 5022897aaceb -> 2c8af9671032

ALTER TABLE documents ADD COLUMN doc_language VARCHAR(255);

UPDATE alembic_version SET version_num='2c8af9671032' WHERE alembic_version.version_num = '5022897aaceb';

-- Running upgrade 2c8af9671032 -> e8883b0148c9

ALTER TABLE datasets ADD COLUMN embedding_model VARCHAR(255) DEFAULT 'text-embedding-ada-002'::character varying NOT NULL;

ALTER TABLE datasets ADD COLUMN embedding_model_provider VARCHAR(255) DEFAULT 'openai'::character varying NOT NULL;

UPDATE alembic_version SET version_num='e8883b0148c9' WHERE alembic_version.version_num = '2c8af9671032';

-- Running upgrade e8883b0148c9 -> 853f9b9cd3b6

ALTER TABLE message_agent_thoughts ADD COLUMN message_price_unit NUMERIC(10, 7) DEFAULT 0.001 NOT NULL;

ALTER TABLE message_agent_thoughts ADD COLUMN answer_price_unit NUMERIC(10, 7) DEFAULT 0.001 NOT NULL;

ALTER TABLE messages ADD COLUMN message_price_unit NUMERIC(10, 7) DEFAULT 0.001 NOT NULL;

ALTER TABLE messages ADD COLUMN answer_price_unit NUMERIC(10, 7) DEFAULT 0.001 NOT NULL;

UPDATE alembic_version SET version_num='853f9b9cd3b6' WHERE alembic_version.version_num = 'e8883b0148c9';

-- Running upgrade 853f9b9cd3b6 -> 4bcffcd64aa4

ALTER TABLE datasets ALTER COLUMN embedding_model DROP NOT NULL;

ALTER TABLE datasets ALTER COLUMN embedding_model_provider DROP NOT NULL;

UPDATE alembic_version SET version_num='4bcffcd64aa4' WHERE alembic_version.version_num = '853f9b9cd3b6';

-- Running upgrade 4bcffcd64aa4 -> 6dcb43972bdc

CREATE TABLE dataset_retriever_resources (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    message_id UUID NOT NULL, 
    position INTEGER NOT NULL, 
    dataset_id UUID NOT NULL, 
    dataset_name TEXT NOT NULL, 
    document_id UUID NOT NULL, 
    document_name TEXT NOT NULL, 
    data_source_type TEXT NOT NULL, 
    segment_id UUID NOT NULL, 
    score FLOAT, 
    content TEXT NOT NULL, 
    hit_count INTEGER, 
    word_count INTEGER, 
    segment_position INTEGER, 
    index_node_hash TEXT, 
    retriever_from TEXT NOT NULL, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT dataset_retriever_resource_pkey PRIMARY KEY (id)
);

CREATE INDEX dataset_retriever_resource_message_id_idx ON dataset_retriever_resources (message_id);

UPDATE alembic_version SET version_num='6dcb43972bdc' WHERE alembic_version.version_num = '4bcffcd64aa4';

-- Running upgrade 6dcb43972bdc -> 77e83833755c

ALTER TABLE app_model_configs ADD COLUMN retriever_resource TEXT;

UPDATE alembic_version SET version_num='77e83833755c' WHERE alembic_version.version_num = '6dcb43972bdc';

-- Running upgrade 77e83833755c -> 6e2cfb077b04

CREATE TABLE dataset_collection_bindings (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    provider_name VARCHAR(40) NOT NULL, 
    model_name VARCHAR(40) NOT NULL, 
    collection_name VARCHAR(64) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT dataset_collection_bindings_pkey PRIMARY KEY (id)
);

CREATE INDEX provider_model_name_idx ON dataset_collection_bindings (provider_name, model_name);

ALTER TABLE datasets ADD COLUMN collection_binding_id UUID;

UPDATE alembic_version SET version_num='6e2cfb077b04' WHERE alembic_version.version_num = '77e83833755c';

-- Running upgrade 6e2cfb077b04 -> ab23c11305d4

ALTER TABLE app_model_configs ADD COLUMN dataset_query_variable VARCHAR(255);

UPDATE alembic_version SET version_num='ab23c11305d4' WHERE alembic_version.version_num = '6e2cfb077b04';

-- Running upgrade ab23c11305d4 -> 2e9819ca5b28

ALTER TABLE api_tokens ADD COLUMN tenant_id UUID;

CREATE INDEX api_token_tenant_idx ON api_tokens (tenant_id, type);

ALTER TABLE api_tokens DROP COLUMN dataset_id;

UPDATE alembic_version SET version_num='2e9819ca5b28' WHERE alembic_version.version_num = 'ab23c11305d4';

-- Running upgrade 2e9819ca5b28 -> b3a09c049e8e

ALTER TABLE app_model_configs ADD COLUMN prompt_type VARCHAR(255) DEFAULT 'simple' NOT NULL;

ALTER TABLE app_model_configs ADD COLUMN chat_prompt_config TEXT;

ALTER TABLE app_model_configs ADD COLUMN completion_prompt_config TEXT;

ALTER TABLE app_model_configs ADD COLUMN dataset_configs TEXT;

UPDATE alembic_version SET version_num='b3a09c049e8e' WHERE alembic_version.version_num = '2e9819ca5b28';

-- Running upgrade b3a09c049e8e -> 968fff4c0ab9

CREATE TABLE api_based_extensions (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    api_endpoint VARCHAR(255) NOT NULL, 
    api_key TEXT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT api_based_extension_pkey PRIMARY KEY (id)
);

CREATE INDEX api_based_extension_tenant_idx ON api_based_extensions (tenant_id);

UPDATE alembic_version SET version_num='968fff4c0ab9' WHERE alembic_version.version_num = 'b3a09c049e8e';

-- Running upgrade 968fff4c0ab9 -> a9836e3baeee

ALTER TABLE app_model_configs ADD COLUMN external_data_tools TEXT;

UPDATE alembic_version SET version_num='a9836e3baeee' WHERE alembic_version.version_num = '968fff4c0ab9';

-- Running upgrade a9836e3baeee -> 8fe468ba0ca5

CREATE TABLE message_files (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    message_id UUID NOT NULL, 
    type VARCHAR(255) NOT NULL, 
    transfer_method VARCHAR(255) NOT NULL, 
    url TEXT, 
    upload_file_id UUID, 
    created_by_role VARCHAR(255) NOT NULL, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT message_file_pkey PRIMARY KEY (id)
);

CREATE INDEX message_file_created_by_idx ON message_files (created_by);

CREATE INDEX message_file_message_idx ON message_files (message_id);

ALTER TABLE app_model_configs ADD COLUMN file_upload TEXT;

ALTER TABLE upload_files ADD COLUMN created_by_role VARCHAR(255) DEFAULT 'account'::character varying NOT NULL;

UPDATE alembic_version SET version_num='8fe468ba0ca5' WHERE alembic_version.version_num = 'a9836e3baeee';

-- Running upgrade 8fe468ba0ca5 -> fca025d3b60f

DROP TABLE sessions;

ALTER TABLE datasets ADD COLUMN retrieval_model JSONB;

CREATE INDEX retrieval_model_idx ON datasets USING gin (retrieval_model);

UPDATE alembic_version SET version_num='fca025d3b60f' WHERE alembic_version.version_num = '8fe468ba0ca5';

-- Running upgrade fca025d3b60f -> e1901f623fd0

CREATE TABLE app_annotation_hit_histories (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    annotation_id UUID NOT NULL, 
    source TEXT NOT NULL, 
    question TEXT NOT NULL, 
    account_id UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT app_annotation_hit_histories_pkey PRIMARY KEY (id)
);

CREATE INDEX app_annotation_hit_histories_account_idx ON app_annotation_hit_histories (account_id);

CREATE INDEX app_annotation_hit_histories_annotation_idx ON app_annotation_hit_histories (annotation_id);

CREATE INDEX app_annotation_hit_histories_app_idx ON app_annotation_hit_histories (app_id);

ALTER TABLE app_model_configs ADD COLUMN annotation_reply TEXT;

ALTER TABLE dataset_collection_bindings ADD COLUMN type VARCHAR(40) DEFAULT 'dataset'::character varying NOT NULL;

ALTER TABLE message_annotations ADD COLUMN question TEXT;

ALTER TABLE message_annotations ADD COLUMN hit_count INTEGER DEFAULT 0 NOT NULL;

ALTER TABLE message_annotations ALTER COLUMN conversation_id DROP NOT NULL;

ALTER TABLE message_annotations ALTER COLUMN message_id DROP NOT NULL;

UPDATE alembic_version SET version_num='e1901f623fd0' WHERE alembic_version.version_num = 'fca025d3b60f';

-- Running upgrade e1901f623fd0 -> 46976cc39132

ALTER TABLE app_annotation_hit_histories ADD COLUMN score FLOAT DEFAULT 0 NOT NULL;

UPDATE alembic_version SET version_num='46976cc39132' WHERE alembic_version.version_num = 'e1901f623fd0';

-- Running upgrade 46976cc39132 -> f2a6fc85e260

ALTER TABLE app_annotation_hit_histories ADD COLUMN message_id UUID NOT NULL;

CREATE INDEX app_annotation_hit_histories_message_idx ON app_annotation_hit_histories (message_id);

UPDATE alembic_version SET version_num='f2a6fc85e260' WHERE alembic_version.version_num = '46976cc39132';

-- Running upgrade f2a6fc85e260 -> 714aafe25d39

ALTER TABLE app_annotation_hit_histories ADD COLUMN annotation_question TEXT NOT NULL;

ALTER TABLE app_annotation_hit_histories ADD COLUMN annotation_content TEXT NOT NULL;

UPDATE alembic_version SET version_num='714aafe25d39' WHERE alembic_version.version_num = 'f2a6fc85e260';

-- Running upgrade 714aafe25d39 -> 246ba09cbbdb

CREATE TABLE app_annotation_settings (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    score_threshold FLOAT DEFAULT 0 NOT NULL, 
    collection_binding_id UUID NOT NULL, 
    created_user_id UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_user_id UUID NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT app_annotation_settings_pkey PRIMARY KEY (id)
);

CREATE INDEX app_annotation_settings_app_idx ON app_annotation_settings (app_id);

ALTER TABLE app_model_configs DROP COLUMN annotation_reply;

UPDATE alembic_version SET version_num='246ba09cbbdb' WHERE alembic_version.version_num = '714aafe25d39';

-- Running upgrade 246ba09cbbdb -> 88072f0caa04

ALTER TABLE tenants ADD COLUMN custom_config TEXT;

UPDATE alembic_version SET version_num='88072f0caa04' WHERE alembic_version.version_num = '246ba09cbbdb';

-- Running upgrade 88072f0caa04 -> 187385f442fc

ALTER TABLE provider_models ALTER COLUMN model_name TYPE VARCHAR(255);

UPDATE alembic_version SET version_num='187385f442fc' WHERE alembic_version.version_num = '88072f0caa04';

-- Running upgrade 187385f442fc -> 89c7899ca936

ALTER TABLE sites ALTER COLUMN description TYPE TEXT;

UPDATE alembic_version SET version_num='89c7899ca936' WHERE alembic_version.version_num = '187385f442fc';

-- Running upgrade 89c7899ca936 -> 3ef9b2b6bee6

CREATE TABLE tool_api_providers (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    name VARCHAR(40) NOT NULL, 
    schema TEXT NOT NULL, 
    schema_type_str VARCHAR(40) NOT NULL, 
    user_id UUID NOT NULL, 
    tenant_id UUID NOT NULL, 
    description_str TEXT NOT NULL, 
    tools_str TEXT NOT NULL, 
    CONSTRAINT tool_api_provider_pkey PRIMARY KEY (id)
);

CREATE TABLE tool_builtin_providers (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID, 
    user_id UUID NOT NULL, 
    provider VARCHAR(40) NOT NULL, 
    encrypted_credentials TEXT, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT tool_builtin_provider_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_builtin_tool_provider UNIQUE (tenant_id, provider)
);

CREATE TABLE tool_published_apps (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    user_id UUID NOT NULL, 
    description TEXT NOT NULL, 
    llm_description TEXT NOT NULL, 
    query_description TEXT NOT NULL, 
    query_name VARCHAR(40) NOT NULL, 
    tool_name VARCHAR(40) NOT NULL, 
    author VARCHAR(40) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT published_app_tool_pkey PRIMARY KEY (id), 
    CONSTRAINT tool_published_apps_app_id_fkey FOREIGN KEY(app_id) REFERENCES apps (id), 
    CONSTRAINT unique_published_app_tool UNIQUE (app_id, user_id)
);

UPDATE alembic_version SET version_num='3ef9b2b6bee6' WHERE alembic_version.version_num = '89c7899ca936';

-- Running upgrade 3ef9b2b6bee6 -> ad472b61a054

ALTER TABLE tool_api_providers ADD COLUMN icon VARCHAR(256) NOT NULL;

UPDATE alembic_version SET version_num='ad472b61a054' WHERE alembic_version.version_num = '3ef9b2b6bee6';

-- Running upgrade ad472b61a054 -> 8ec536f3c800

ALTER TABLE tool_api_providers ADD COLUMN credentials_str TEXT NOT NULL;

UPDATE alembic_version SET version_num='8ec536f3c800' WHERE alembic_version.version_num = 'ad472b61a054';

-- Running upgrade 8ec536f3c800 -> 00bacef91f18

ALTER TABLE tool_api_providers ADD COLUMN description TEXT NOT NULL;

ALTER TABLE tool_api_providers DROP COLUMN description_str;

UPDATE alembic_version SET version_num='00bacef91f18' WHERE alembic_version.version_num = '8ec536f3c800';

-- Running upgrade 00bacef91f18 -> f25003750af4

ALTER TABLE tool_api_providers ADD COLUMN created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL;

ALTER TABLE tool_api_providers ADD COLUMN updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL;

UPDATE alembic_version SET version_num='f25003750af4' WHERE alembic_version.version_num = '00bacef91f18';

-- Running upgrade f25003750af4 -> c71211c8f604

CREATE TABLE tool_model_invokes (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    user_id UUID NOT NULL, 
    tenant_id UUID NOT NULL, 
    provider VARCHAR(40) NOT NULL, 
    tool_type VARCHAR(40) NOT NULL, 
    tool_name VARCHAR(40) NOT NULL, 
    tool_id UUID NOT NULL, 
    model_parameters TEXT NOT NULL, 
    prompt_messages TEXT NOT NULL, 
    model_response TEXT NOT NULL, 
    prompt_tokens INTEGER DEFAULT 0 NOT NULL, 
    answer_tokens INTEGER DEFAULT 0 NOT NULL, 
    answer_unit_price NUMERIC(10, 4) NOT NULL, 
    answer_price_unit NUMERIC(10, 7) DEFAULT 0.001 NOT NULL, 
    provider_response_latency FLOAT DEFAULT 0 NOT NULL, 
    total_price NUMERIC(10, 7), 
    currency VARCHAR(255) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT tool_model_invoke_pkey PRIMARY KEY (id)
);

UPDATE alembic_version SET version_num='c71211c8f604' WHERE alembic_version.version_num = 'f25003750af4';

-- Running upgrade c71211c8f604 -> 114eed84c228

ALTER TABLE tool_model_invokes DROP COLUMN tool_id;

UPDATE alembic_version SET version_num='114eed84c228' WHERE alembic_version.version_num = 'c71211c8f604';

-- Running upgrade 114eed84c228 -> 4829e54d2fee

ALTER TABLE message_agent_thoughts ALTER COLUMN message_chain_id DROP NOT NULL;

UPDATE alembic_version SET version_num='4829e54d2fee' WHERE alembic_version.version_num = '114eed84c228';

-- Running upgrade 4829e54d2fee -> 053da0c1d756

CREATE TABLE tool_conversation_variables (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    user_id UUID NOT NULL, 
    tenant_id UUID NOT NULL, 
    conversation_id UUID NOT NULL, 
    variables_str TEXT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT tool_conversation_variables_pkey PRIMARY KEY (id)
);

ALTER TABLE tool_api_providers ADD COLUMN privacy_policy VARCHAR(255);

ALTER TABLE tool_api_providers ALTER COLUMN icon TYPE VARCHAR(255);

UPDATE alembic_version SET version_num='053da0c1d756' WHERE alembic_version.version_num = '4829e54d2fee';

-- Running upgrade 053da0c1d756 -> 4823da1d26cf

CREATE TABLE tool_files (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    user_id UUID NOT NULL, 
    tenant_id UUID NOT NULL, 
    conversation_id UUID NOT NULL, 
    file_key VARCHAR(255) NOT NULL, 
    mimetype VARCHAR(255) NOT NULL, 
    original_url VARCHAR(255), 
    CONSTRAINT tool_file_pkey PRIMARY KEY (id)
);

UPDATE alembic_version SET version_num='4823da1d26cf' WHERE alembic_version.version_num = '053da0c1d756';

-- Running upgrade 4823da1d26cf -> 9fafbd60eca1

ALTER TABLE message_files ADD COLUMN belongs_to VARCHAR(255);

UPDATE alembic_version SET version_num='9fafbd60eca1' WHERE alembic_version.version_num = '4823da1d26cf';

-- Running upgrade 9fafbd60eca1 -> 8ae9bc661daa

CREATE INDEX conversation_id_idx ON tool_conversation_variables (conversation_id);

CREATE INDEX user_id_idx ON tool_conversation_variables (user_id);

UPDATE alembic_version SET version_num='8ae9bc661daa' WHERE alembic_version.version_num = '9fafbd60eca1';

-- Running upgrade 8ae9bc661daa -> 23db93619b9d

ALTER TABLE message_agent_thoughts ADD COLUMN message_files TEXT;

UPDATE alembic_version SET version_num='23db93619b9d' WHERE alembic_version.version_num = '8ae9bc661daa';

-- Running upgrade 23db93619b9d -> de95f5c77138

    /*
    1. select all tool_providers
    2. insert api_key to tool_provider_configs

    tool_providers
    - id
    - tenant_id
    - tool_name
    - encrypted_credentials
        {"api_key": "$KEY"}
    - created_at
    - updated_at

    tool_builtin_providers
    - id <- tool_providers.id
    - tenant_id <- tool_providers.tenant_id
    - user_id <- tenant_account_joins.account_id (tenant_account_joins.tenant_id = tool_providers.tenant_id and tenant_account_joins.role = 'owner')
    - encrypted_credentials <- tool_providers.encrypted_credentials
        {"serpapi_api_key": "$KEY"}
    - created_at <- tool_providers.created_at
    - updated_at <- tool_providers.updated_at
    */

UPDATE alembic_version SET version_num='de95f5c77138' WHERE alembic_version.version_num = '23db93619b9d';

-- Running upgrade de95f5c77138 -> b24be59fbb04

ALTER TABLE app_model_configs ADD COLUMN text_to_speech TEXT;

UPDATE alembic_version SET version_num='b24be59fbb04' WHERE alembic_version.version_num = 'de95f5c77138';

-- Running upgrade b24be59fbb04 -> dfb3b7f477da

ALTER TABLE tool_api_providers ADD CONSTRAINT unique_api_tool_provider UNIQUE (name, tenant_id);

CREATE INDEX tool_file_conversation_id_idx ON tool_files (conversation_id);

UPDATE alembic_version SET version_num='dfb3b7f477da' WHERE alembic_version.version_num = 'b24be59fbb04';

-- Running upgrade dfb3b7f477da -> 380c6aa5a70d

ALTER TABLE message_agent_thoughts ADD COLUMN tool_labels_str TEXT DEFAULT '{}'::text NOT NULL;

UPDATE alembic_version SET version_num='380c6aa5a70d' WHERE alembic_version.version_num = 'dfb3b7f477da';

-- Running upgrade 380c6aa5a70d -> 16830a790f0f

ALTER TABLE tenant_account_joins ADD COLUMN current BOOLEAN DEFAULT false NOT NULL;

UPDATE alembic_version SET version_num='16830a790f0f' WHERE alembic_version.version_num = '380c6aa5a70d';

-- Running upgrade 16830a790f0f -> a8f9b3c45e4a

CREATE INDEX document_segment_tenant_idx ON document_segments (tenant_id);

CREATE INDEX document_tenant_idx ON documents (tenant_id);

UPDATE alembic_version SET version_num='a8f9b3c45e4a' WHERE alembic_version.version_num = '16830a790f0f';

-- Running upgrade a8f9b3c45e4a -> 17b5ab037c40

ALTER TABLE dataset_keyword_tables ADD COLUMN data_source_type VARCHAR(255) DEFAULT 'database'::character varying NOT NULL;

UPDATE alembic_version SET version_num='17b5ab037c40' WHERE alembic_version.version_num = 'a8f9b3c45e4a';

-- Running upgrade 17b5ab037c40 -> a8d7385a7b66

ALTER TABLE embeddings ADD COLUMN provider_name VARCHAR(40) DEFAULT ''::character varying NOT NULL;

ALTER TABLE embeddings DROP CONSTRAINT embedding_hash_idx;

ALTER TABLE embeddings ADD CONSTRAINT embedding_hash_idx UNIQUE (model_name, hash, provider_name);

UPDATE alembic_version SET version_num='a8d7385a7b66' WHERE alembic_version.version_num = '17b5ab037c40';

-- Running upgrade a8d7385a7b66 -> b289e2408ee2

CREATE TABLE workflow_app_logs (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    app_id UUID NOT NULL, 
    workflow_id UUID NOT NULL, 
    workflow_run_id UUID NOT NULL, 
    created_from VARCHAR(255) NOT NULL, 
    created_by_role VARCHAR(255) NOT NULL, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT workflow_app_log_pkey PRIMARY KEY (id)
);

CREATE INDEX workflow_app_log_app_idx ON workflow_app_logs (tenant_id, app_id);

CREATE TABLE workflow_node_executions (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    app_id UUID NOT NULL, 
    workflow_id UUID NOT NULL, 
    triggered_from VARCHAR(255) NOT NULL, 
    workflow_run_id UUID, 
    index INTEGER NOT NULL, 
    predecessor_node_id VARCHAR(255), 
    node_id VARCHAR(255) NOT NULL, 
    node_type VARCHAR(255) NOT NULL, 
    title VARCHAR(255) NOT NULL, 
    inputs TEXT, 
    process_data TEXT, 
    outputs TEXT, 
    status VARCHAR(255) NOT NULL, 
    error TEXT, 
    elapsed_time FLOAT DEFAULT 0 NOT NULL, 
    execution_metadata TEXT, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    created_by_role VARCHAR(255) NOT NULL, 
    created_by UUID NOT NULL, 
    finished_at TIMESTAMP WITHOUT TIME ZONE, 
    CONSTRAINT workflow_node_execution_pkey PRIMARY KEY (id)
);

CREATE INDEX workflow_node_execution_node_run_idx ON workflow_node_executions (tenant_id, app_id, workflow_id, triggered_from, node_id);

CREATE INDEX workflow_node_execution_workflow_run_idx ON workflow_node_executions (tenant_id, app_id, workflow_id, triggered_from, workflow_run_id);

CREATE TABLE workflow_runs (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    app_id UUID NOT NULL, 
    sequence_number INTEGER NOT NULL, 
    workflow_id UUID NOT NULL, 
    type VARCHAR(255) NOT NULL, 
    triggered_from VARCHAR(255) NOT NULL, 
    version VARCHAR(255) NOT NULL, 
    graph TEXT, 
    inputs TEXT, 
    status VARCHAR(255) NOT NULL, 
    outputs TEXT, 
    error TEXT, 
    elapsed_time FLOAT DEFAULT 0 NOT NULL, 
    total_tokens INTEGER DEFAULT 0 NOT NULL, 
    total_steps INTEGER DEFAULT 0, 
    created_by_role VARCHAR(255) NOT NULL, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    finished_at TIMESTAMP WITHOUT TIME ZONE, 
    CONSTRAINT workflow_run_pkey PRIMARY KEY (id)
);

CREATE INDEX workflow_run_triggerd_from_idx ON workflow_runs (tenant_id, app_id, triggered_from);

CREATE TABLE workflows (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    app_id UUID NOT NULL, 
    type VARCHAR(255) NOT NULL, 
    version VARCHAR(255) NOT NULL, 
    graph TEXT, 
    features TEXT, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_by UUID, 
    updated_at TIMESTAMP WITHOUT TIME ZONE, 
    CONSTRAINT workflow_pkey PRIMARY KEY (id)
);

CREATE INDEX workflow_version_idx ON workflows (tenant_id, app_id, version);

ALTER TABLE apps ADD COLUMN workflow_id UUID;

ALTER TABLE messages ADD COLUMN workflow_run_id UUID;

UPDATE alembic_version SET version_num='b289e2408ee2' WHERE alembic_version.version_num = 'a8d7385a7b66';

-- Running upgrade b289e2408ee2 -> cc04d0998d4d

ALTER TABLE app_model_configs ALTER COLUMN provider DROP NOT NULL;

ALTER TABLE app_model_configs ALTER COLUMN model_id DROP NOT NULL;

ALTER TABLE app_model_configs ALTER COLUMN configs DROP NOT NULL;

ALTER TABLE apps ALTER COLUMN api_rpm SET NOT NULL;

ALTER TABLE apps ALTER COLUMN api_rpm SET DEFAULT '0';

ALTER TABLE apps ALTER COLUMN api_rph SET NOT NULL;

ALTER TABLE apps ALTER COLUMN api_rph SET DEFAULT '0';

UPDATE alembic_version SET version_num='cc04d0998d4d' WHERE alembic_version.version_num = 'b289e2408ee2';

-- Running upgrade cc04d0998d4d -> f9107f83abab

ALTER TABLE apps ADD COLUMN description TEXT DEFAULT ''::character varying NOT NULL;

UPDATE alembic_version SET version_num='f9107f83abab' WHERE alembic_version.version_num = 'cc04d0998d4d';

-- Running upgrade f9107f83abab -> 42e85ed5564d

ALTER TABLE conversations ALTER COLUMN app_model_config_id DROP NOT NULL;

ALTER TABLE conversations ALTER COLUMN model_provider DROP NOT NULL;

ALTER TABLE conversations ALTER COLUMN model_id DROP NOT NULL;

UPDATE alembic_version SET version_num='42e85ed5564d' WHERE alembic_version.version_num = 'f9107f83abab';

-- Running upgrade 42e85ed5564d -> b5429b71023c

ALTER TABLE messages ALTER COLUMN model_provider DROP NOT NULL;

ALTER TABLE messages ALTER COLUMN model_id DROP NOT NULL;

UPDATE alembic_version SET version_num='b5429b71023c' WHERE alembic_version.version_num = '42e85ed5564d';

-- Running upgrade b5429b71023c -> 563cf8bf777b

ALTER TABLE tool_files ALTER COLUMN conversation_id DROP NOT NULL;

UPDATE alembic_version SET version_num='563cf8bf777b' WHERE alembic_version.version_num = 'b5429b71023c';

-- Running upgrade 563cf8bf777b -> e2eacc9a1b63

ALTER TABLE conversations ADD COLUMN invoke_from VARCHAR(255);

ALTER TABLE messages ADD COLUMN status VARCHAR(255) DEFAULT 'normal'::character varying NOT NULL;

ALTER TABLE messages ADD COLUMN error TEXT;

ALTER TABLE messages ADD COLUMN message_metadata TEXT;

ALTER TABLE messages ADD COLUMN invoke_from VARCHAR(255);

UPDATE alembic_version SET version_num='e2eacc9a1b63' WHERE alembic_version.version_num = '563cf8bf777b';

-- Running upgrade e2eacc9a1b63 -> c3311b089690

ALTER TABLE message_agent_thoughts ADD COLUMN tool_meta_str TEXT DEFAULT '{}'::text NOT NULL;

UPDATE alembic_version SET version_num='c3311b089690' WHERE alembic_version.version_num = 'e2eacc9a1b63';

-- Running upgrade c3311b089690 -> 3c7cac9521c6

CREATE TABLE tag_bindings (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID, 
    tag_id UUID, 
    target_id UUID, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT tag_binding_pkey PRIMARY KEY (id)
);

CREATE INDEX tag_bind_tag_id_idx ON tag_bindings (tag_id);

CREATE INDEX tag_bind_target_id_idx ON tag_bindings (target_id);

CREATE TABLE tags (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID, 
    type VARCHAR(16) NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT tag_pkey PRIMARY KEY (id)
);

CREATE INDEX tag_name_idx ON tags (name);

CREATE INDEX tag_type_idx ON tags (type);

UPDATE alembic_version SET version_num='3c7cac9521c6' WHERE alembic_version.version_num = 'c3311b089690';

-- Running upgrade 3c7cac9521c6 -> 47cc7df8c4f3

ALTER TABLE tenant_default_models ALTER COLUMN model_name TYPE VARCHAR(255);

UPDATE alembic_version SET version_num='47cc7df8c4f3' WHERE alembic_version.version_num = '3c7cac9521c6';

-- Running upgrade 47cc7df8c4f3 -> 5fda94355fce

ALTER TABLE recommended_apps ADD COLUMN custom_disclaimer VARCHAR(255);

ALTER TABLE sites ADD COLUMN custom_disclaimer VARCHAR(255);

ALTER TABLE tool_api_providers ADD COLUMN custom_disclaimer VARCHAR(255);

UPDATE alembic_version SET version_num='5fda94355fce' WHERE alembic_version.version_num = '47cc7df8c4f3';

-- Running upgrade 5fda94355fce -> 7bdef072e63a

CREATE TABLE tool_workflow_providers (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    name VARCHAR(40) NOT NULL, 
    icon VARCHAR(255) NOT NULL, 
    app_id UUID NOT NULL, 
    user_id UUID NOT NULL, 
    tenant_id UUID NOT NULL, 
    description TEXT NOT NULL, 
    parameter_configuration TEXT DEFAULT '[]' NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT tool_workflow_provider_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_workflow_tool_provider UNIQUE (name, tenant_id), 
    CONSTRAINT unique_workflow_tool_provider_app_id UNIQUE (tenant_id, app_id)
);

UPDATE alembic_version SET version_num='7bdef072e63a' WHERE alembic_version.version_num = '5fda94355fce';

-- Running upgrade 7bdef072e63a -> 3b18fea55204

CREATE TABLE tool_label_bindings (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tool_id VARCHAR(64) NOT NULL, 
    tool_type VARCHAR(40) NOT NULL, 
    label_name VARCHAR(40) NOT NULL, 
    CONSTRAINT tool_label_bind_pkey PRIMARY KEY (id)
);

ALTER TABLE tool_workflow_providers ADD COLUMN privacy_policy VARCHAR(255) DEFAULT '';

UPDATE alembic_version SET version_num='3b18fea55204' WHERE alembic_version.version_num = '7bdef072e63a';

-- Running upgrade 3b18fea55204 -> 9e98fbaffb88

ALTER TABLE tool_workflow_providers ADD COLUMN version VARCHAR(255) DEFAULT '' NOT NULL;

UPDATE alembic_version SET version_num='9e98fbaffb88' WHERE alembic_version.version_num = '3b18fea55204';

-- Running upgrade 9e98fbaffb88 -> 03f98355ba0e

ALTER TABLE tool_label_bindings ADD CONSTRAINT unique_tool_label_bind UNIQUE (tool_id, label_name);

ALTER TABLE tool_workflow_providers ADD COLUMN label VARCHAR(255) DEFAULT '' NOT NULL;

UPDATE alembic_version SET version_num='03f98355ba0e' WHERE alembic_version.version_num = '9e98fbaffb88';

-- Running upgrade 03f98355ba0e -> 64a70a7aab8b

CREATE INDEX workflow_run_tenant_app_sequence_idx ON workflow_runs (tenant_id, app_id, sequence_number);

UPDATE alembic_version SET version_num='64a70a7aab8b' WHERE alembic_version.version_num = '03f98355ba0e';

-- Running upgrade 64a70a7aab8b -> 4e99a8df00ff

CREATE TABLE load_balancing_model_configs (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    provider_name VARCHAR(255) NOT NULL, 
    model_name VARCHAR(255) NOT NULL, 
    model_type VARCHAR(40) NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    encrypted_config TEXT, 
    enabled BOOLEAN DEFAULT true NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT load_balancing_model_config_pkey PRIMARY KEY (id)
);

CREATE INDEX load_balancing_model_config_tenant_provider_model_idx ON load_balancing_model_configs (tenant_id, provider_name, model_type);

CREATE TABLE provider_model_settings (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    provider_name VARCHAR(255) NOT NULL, 
    model_name VARCHAR(255) NOT NULL, 
    model_type VARCHAR(40) NOT NULL, 
    enabled BOOLEAN DEFAULT true NOT NULL, 
    load_balancing_enabled BOOLEAN DEFAULT false NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT provider_model_setting_pkey PRIMARY KEY (id)
);

CREATE INDEX provider_model_setting_tenant_provider_model_idx ON provider_model_settings (tenant_id, provider_name, model_type);

ALTER TABLE provider_models ALTER COLUMN provider_name TYPE VARCHAR(255);

ALTER TABLE provider_orders ALTER COLUMN provider_name TYPE VARCHAR(255);

ALTER TABLE providers ALTER COLUMN provider_name TYPE VARCHAR(255);

ALTER TABLE tenant_default_models ALTER COLUMN provider_name TYPE VARCHAR(255);

ALTER TABLE tenant_preferred_model_providers ALTER COLUMN provider_name TYPE VARCHAR(255);

UPDATE alembic_version SET version_num='4e99a8df00ff' WHERE alembic_version.version_num = '64a70a7aab8b';

-- Running upgrade 4e99a8df00ff -> 7b45942e39bb

CREATE TABLE data_source_api_key_auth_bindings (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    category VARCHAR(255) NOT NULL, 
    provider VARCHAR(255) NOT NULL, 
    credentials TEXT, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    disabled BOOLEAN DEFAULT false, 
    CONSTRAINT data_source_api_key_auth_binding_pkey PRIMARY KEY (id)
);

CREATE INDEX data_source_api_key_auth_binding_provider_idx ON data_source_api_key_auth_bindings (provider);

CREATE INDEX data_source_api_key_auth_binding_tenant_id_idx ON data_source_api_key_auth_bindings (tenant_id);

DROP INDEX source_binding_tenant_id_idx;

DROP INDEX source_info_idx;

ALTER TABLE data_source_bindings RENAME TO data_source_oauth_bindings;

CREATE INDEX source_binding_tenant_id_idx ON data_source_oauth_bindings (tenant_id);

CREATE INDEX source_info_idx ON data_source_oauth_bindings USING gin (source_info);

UPDATE alembic_version SET version_num='7b45942e39bb' WHERE alembic_version.version_num = '4e99a8df00ff';

-- Running upgrade 7b45942e39bb -> 4ff534e1eb11

ALTER TABLE sites ADD COLUMN show_workflow_steps BOOLEAN DEFAULT true NOT NULL;

UPDATE alembic_version SET version_num='4ff534e1eb11' WHERE alembic_version.version_num = '7b45942e39bb';

-- Running upgrade 4ff534e1eb11 -> b69ca54b9208

ALTER TABLE sites ADD COLUMN chat_color_theme VARCHAR(255);

ALTER TABLE sites ADD COLUMN chat_color_theme_inverted BOOLEAN DEFAULT false NOT NULL;

UPDATE alembic_version SET version_num='b69ca54b9208' WHERE alembic_version.version_num = '4ff534e1eb11';

-- Running upgrade 4ff534e1eb11 -> 04c602f5dc9b

CREATE TABLE tracing_app_configs (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    tracing_provider VARCHAR(255), 
    tracing_config JSON, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT tracing_app_config_pkey PRIMARY KEY (id)
);

INSERT INTO alembic_version (version_num) VALUES ('04c602f5dc9b') RETURNING alembic_version.version_num;

-- Running upgrade 04c602f5dc9b -> c031d46af369

CREATE TABLE trace_app_config (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    tracing_provider VARCHAR(255), 
    tracing_config JSON, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now() NOT NULL, 
    is_active BOOLEAN DEFAULT true NOT NULL, 
    CONSTRAINT trace_app_config_pkey PRIMARY KEY (id)
);

CREATE INDEX trace_app_config_app_id_idx ON trace_app_config (app_id);

UPDATE alembic_version SET version_num='c031d46af369' WHERE alembic_version.version_num = '04c602f5dc9b';

-- Running upgrade c031d46af369 -> 2a3aebbbf4bb

ALTER TABLE apps ADD COLUMN tracing TEXT;

UPDATE alembic_version SET version_num='2a3aebbbf4bb' WHERE alembic_version.version_num = 'c031d46af369';

-- Running upgrade 2a3aebbbf4bb, b69ca54b9208 -> 63f9175e515b

DELETE FROM alembic_version WHERE alembic_version.version_num = '2a3aebbbf4bb';

UPDATE alembic_version SET version_num='63f9175e515b' WHERE alembic_version.version_num = 'b69ca54b9208';

-- Running upgrade 63f9175e515b -> b2602e131636

CREATE INDEX message_workflow_run_id_idx ON messages (conversation_id, workflow_run_id);

UPDATE alembic_version SET version_num='b2602e131636' WHERE alembic_version.version_num = '63f9175e515b';

-- Running upgrade b2602e131636 -> 7e6a8693e07a

CREATE TABLE dataset_permissions (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    dataset_id UUID NOT NULL, 
    account_id UUID NOT NULL, 
    has_permission BOOLEAN DEFAULT true NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT dataset_permission_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_dataset_permissions_account_id ON dataset_permissions (account_id);

CREATE INDEX idx_dataset_permissions_dataset_id ON dataset_permissions (dataset_id);

UPDATE alembic_version SET version_num='7e6a8693e07a' WHERE alembic_version.version_num = 'b2602e131636';

-- Running upgrade 7e6a8693e07a -> 161cadc1af8d

ALTER TABLE dataset_permissions ADD COLUMN tenant_id UUID NOT NULL;

UPDATE alembic_version SET version_num='161cadc1af8d' WHERE alembic_version.version_num = '7e6a8693e07a';

-- Running upgrade 161cadc1af8d -> 408176b91ad3

ALTER TABLE apps ADD COLUMN max_active_requests INTEGER;

UPDATE alembic_version SET version_num='408176b91ad3' WHERE alembic_version.version_num = '161cadc1af8d';

-- Running upgrade 408176b91ad3 -> fecff1c3da27

DROP TABLE tracing_app_configs;

CREATE INDEX idx_dataset_permissions_tenant_id ON dataset_permissions (tenant_id);

UPDATE alembic_version SET version_num='fecff1c3da27' WHERE alembic_version.version_num = '408176b91ad3';

-- Running upgrade fecff1c3da27 -> 6e957a32015b

CREATE INDEX created_at_idx ON embeddings (created_at);

UPDATE alembic_version SET version_num='6e957a32015b' WHERE alembic_version.version_num = 'fecff1c3da27';

-- Running upgrade 6e957a32015b -> 8e5588e6412e

ALTER TABLE workflows ADD COLUMN environment_variables TEXT DEFAULT '{}' NOT NULL;

UPDATE alembic_version SET version_num='8e5588e6412e' WHERE alembic_version.version_num = '6e957a32015b';

-- Running upgrade 8e5588e6412e -> 53bf8af60645

ALTER TABLE embeddings ALTER COLUMN provider_name TYPE VARCHAR(255);

UPDATE alembic_version SET version_num='53bf8af60645' WHERE alembic_version.version_num = '8e5588e6412e';

-- Running upgrade 53bf8af60645 -> eeb2e349e6ac

ALTER TABLE dataset_collection_bindings ALTER COLUMN model_name TYPE VARCHAR(255);

ALTER TABLE embeddings ALTER COLUMN model_name TYPE VARCHAR(255);

UPDATE alembic_version SET version_num='eeb2e349e6ac' WHERE alembic_version.version_num = '53bf8af60645';

-- Running upgrade eeb2e349e6ac -> 1787fbae959a

ALTER TABLE tool_files ALTER COLUMN original_url TYPE VARCHAR(2048);

UPDATE alembic_version SET version_num='1787fbae959a' WHERE alembic_version.version_num = 'eeb2e349e6ac';

-- Running upgrade 1787fbae959a -> 63a83fcf12ba

CREATE TABLE workflow__conversation_variables (
    id UUID NOT NULL, 
    conversation_id UUID NOT NULL, 
    app_id UUID NOT NULL, 
    data TEXT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT workflow__conversation_variables_pkey PRIMARY KEY (id, conversation_id)
);

CREATE INDEX workflow__conversation_variables_app_id_idx ON workflow__conversation_variables (app_id);

CREATE INDEX workflow__conversation_variables_created_at_idx ON workflow__conversation_variables (created_at);

ALTER TABLE workflows ADD COLUMN conversation_variables TEXT DEFAULT '{}' NOT NULL;

UPDATE alembic_version SET version_num='63a83fcf12ba' WHERE alembic_version.version_num = '1787fbae959a';

-- Running upgrade 63a83fcf12ba -> 8782057ff0dc

ALTER TABLE conversations ADD COLUMN dialogue_count INTEGER DEFAULT '0' NOT NULL;

UPDATE alembic_version SET version_num='8782057ff0dc' WHERE alembic_version.version_num = '63a83fcf12ba';

-- Running upgrade 8782057ff0dc -> a6be81136580

ALTER TABLE apps ADD COLUMN icon_type VARCHAR(255);

ALTER TABLE sites ADD COLUMN icon_type VARCHAR(255);

UPDATE alembic_version SET version_num='a6be81136580' WHERE alembic_version.version_num = '8782057ff0dc';

-- Running upgrade a6be81136580 -> 2dbe42621d96

ALTER TABLE workflow__conversation_variables RENAME TO workflow_conversation_variables;

UPDATE alembic_version SET version_num='2dbe42621d96' WHERE alembic_version.version_num = 'a6be81136580';

-- Running upgrade 2dbe42621d96 -> d0187d6a88dd

ALTER TABLE app_model_configs ADD COLUMN created_by UUID;

ALTER TABLE app_model_configs ADD COLUMN updated_by UUID;

ALTER TABLE apps ADD COLUMN created_by UUID;

ALTER TABLE apps ADD COLUMN updated_by UUID;

ALTER TABLE sites ADD COLUMN created_by UUID;

ALTER TABLE sites ADD COLUMN updated_by UUID;

UPDATE alembic_version SET version_num='d0187d6a88dd' WHERE alembic_version.version_num = '2dbe42621d96';

-- Running upgrade d0187d6a88dd -> 030f4915f36a

ALTER TABLE apps ADD COLUMN use_icon_as_answer_icon BOOLEAN DEFAULT false NOT NULL;

ALTER TABLE sites ADD COLUMN use_icon_as_answer_icon BOOLEAN DEFAULT false NOT NULL;

UPDATE alembic_version SET version_num='030f4915f36a' WHERE alembic_version.version_num = 'd0187d6a88dd';

-- Running upgrade 030f4915f36a -> 675b5321501b

ALTER TABLE workflow_node_executions ADD COLUMN node_execution_id VARCHAR(255);

CREATE INDEX workflow_node_execution_id_idx ON workflow_node_executions (tenant_id, app_id, workflow_id, triggered_from, node_execution_id);

UPDATE alembic_version SET version_num='675b5321501b' WHERE alembic_version.version_num = '030f4915f36a';

-- Running upgrade 675b5321501b -> d57ba9ebb251

ALTER TABLE messages ADD COLUMN parent_message_id UUID;

UPDATE messages SET parent_message_id = uuid_nil() WHERE parent_message_id IS NULL;

UPDATE alembic_version SET version_num='d57ba9ebb251' WHERE alembic_version.version_num = '675b5321501b';

-- Running upgrade d57ba9ebb251 -> 6af6a521a53e

ALTER TABLE dataset_retriever_resources ALTER COLUMN document_id DROP NOT NULL;

ALTER TABLE dataset_retriever_resources ALTER COLUMN data_source_type DROP NOT NULL;

ALTER TABLE dataset_retriever_resources ALTER COLUMN segment_id DROP NOT NULL;

UPDATE alembic_version SET version_num='6af6a521a53e' WHERE alembic_version.version_num = 'd57ba9ebb251';

-- Running upgrade 6af6a521a53e -> 33f5fac87f29

CREATE TABLE external_knowledge_apis (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    description VARCHAR(255) NOT NULL, 
    tenant_id UUID NOT NULL, 
    settings TEXT, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_by UUID, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT external_knowledge_apis_pkey PRIMARY KEY (id)
);

CREATE INDEX external_knowledge_apis_name_idx ON external_knowledge_apis (name);

CREATE INDEX external_knowledge_apis_tenant_idx ON external_knowledge_apis (tenant_id);

CREATE TABLE external_knowledge_bindings (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    external_knowledge_api_id UUID NOT NULL, 
    dataset_id UUID NOT NULL, 
    external_knowledge_id TEXT NOT NULL, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_by UUID, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT external_knowledge_bindings_pkey PRIMARY KEY (id)
);

CREATE INDEX external_knowledge_bindings_dataset_idx ON external_knowledge_bindings (dataset_id);

CREATE INDEX external_knowledge_bindings_external_knowledge_api_idx ON external_knowledge_bindings (external_knowledge_api_id);

CREATE INDEX external_knowledge_bindings_external_knowledge_idx ON external_knowledge_bindings (external_knowledge_id);

CREATE INDEX external_knowledge_bindings_tenant_idx ON external_knowledge_bindings (tenant_id);

UPDATE alembic_version SET version_num='33f5fac87f29' WHERE alembic_version.version_num = '6af6a521a53e';

-- Running upgrade 33f5fac87f29 -> d8e744d88ed6

UPDATE
    messages
SET
    parent_message_id = '00000000-0000-0000-0000-000000000000'
WHERE
    invoke_from = 'service-api'
    AND parent_message_id IS NULL
    AND created_at >= '2024-09-29 12:00:00';;

UPDATE alembic_version SET version_num='d8e744d88ed6' WHERE alembic_version.version_num = '33f5fac87f29';

-- Running upgrade d8e744d88ed6 -> bbadea11becb

-- Executing in offline mode, assuming the name and size columns do not exist.
-- The generated SQL may differ from what will actually be executed.
-- Please review the migration script carefully!;

ALTER TABLE tool_files ADD COLUMN name VARCHAR;

ALTER TABLE tool_files ADD COLUMN size INTEGER;

UPDATE tool_files SET name = '' WHERE name IS NULL;

UPDATE tool_files SET size = -1 WHERE size IS NULL;

ALTER TABLE tool_files ALTER COLUMN name SET NOT NULL;

ALTER TABLE tool_files ALTER COLUMN size SET NOT NULL;

UPDATE alembic_version SET version_num='bbadea11becb' WHERE alembic_version.version_num = 'd8e744d88ed6';

-- Running upgrade bbadea11becb -> 0251a1c768cc

CREATE TABLE tidb_auth_bindings (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID, 
    cluster_id VARCHAR(255) NOT NULL, 
    cluster_name VARCHAR(255) NOT NULL, 
    active BOOLEAN DEFAULT false NOT NULL, 
    status VARCHAR(255) DEFAULT 'CREATING'::character varying NOT NULL, 
    account VARCHAR(255) NOT NULL, 
    password VARCHAR(255) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT tidb_auth_bindings_pkey PRIMARY KEY (id)
);

CREATE INDEX tidb_auth_bindings_active_idx ON tidb_auth_bindings (active);

CREATE INDEX tidb_auth_bindings_status_idx ON tidb_auth_bindings (status);

CREATE INDEX tidb_auth_bindings_created_at_idx ON tidb_auth_bindings (created_at);

CREATE INDEX tidb_auth_bindings_tenant_idx ON tidb_auth_bindings (tenant_id);

UPDATE alembic_version SET version_num='0251a1c768cc' WHERE alembic_version.version_num = 'bbadea11becb';

-- Running upgrade 0251a1c768cc -> 43fa78bc3b7d

CREATE TABLE whitelists (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID, 
    category VARCHAR(255) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT whitelists_pkey PRIMARY KEY (id)
);

CREATE INDEX whitelists_tenant_idx ON whitelists (tenant_id);

UPDATE alembic_version SET version_num='43fa78bc3b7d' WHERE alembic_version.version_num = '0251a1c768cc';

-- Running upgrade 43fa78bc3b7d -> d3f6769a94a3

ALTER TABLE upload_files ADD COLUMN source_url VARCHAR(255) DEFAULT '' NOT NULL;

UPDATE alembic_version SET version_num='d3f6769a94a3' WHERE alembic_version.version_num = '43fa78bc3b7d';

-- Running upgrade d3f6769a94a3 -> 93ad8c19c40b

ALTER INDEX workflow__conversation_variables_app_id_idx RENAME TO workflow_conversation_variables_app_id_idx;

ALTER INDEX workflow__conversation_variables_created_at_idx RENAME TO workflow_conversation_variables_created_at_idx;

UPDATE alembic_version SET version_num='93ad8c19c40b' WHERE alembic_version.version_num = 'd3f6769a94a3';

-- Running upgrade 93ad8c19c40b -> f4d7ce70a7ca

ALTER TABLE upload_files ALTER COLUMN source_url TYPE TEXT;

UPDATE alembic_version SET version_num='f4d7ce70a7ca' WHERE alembic_version.version_num = '93ad8c19c40b';

-- Running upgrade f4d7ce70a7ca -> d07474999927

UPDATE recommended_apps SET custom_disclaimer = '' WHERE custom_disclaimer IS NULL;

UPDATE sites SET custom_disclaimer = '' WHERE custom_disclaimer IS NULL;

UPDATE tool_api_providers SET custom_disclaimer = '' WHERE custom_disclaimer IS NULL;

ALTER TABLE recommended_apps ALTER COLUMN custom_disclaimer TYPE TEXT;

ALTER TABLE recommended_apps ALTER COLUMN custom_disclaimer SET NOT NULL;

ALTER TABLE sites ALTER COLUMN custom_disclaimer TYPE TEXT;

ALTER TABLE sites ALTER COLUMN custom_disclaimer SET NOT NULL;

ALTER TABLE tool_api_providers ALTER COLUMN custom_disclaimer TYPE TEXT;

ALTER TABLE tool_api_providers ALTER COLUMN custom_disclaimer SET NOT NULL;

UPDATE alembic_version SET version_num='d07474999927' WHERE alembic_version.version_num = 'f4d7ce70a7ca';

-- Running upgrade d07474999927 -> 09a8d1878d9b

ALTER TABLE conversations ALTER COLUMN inputs SET NOT NULL;

ALTER TABLE messages ALTER COLUMN inputs SET NOT NULL;

UPDATE workflows SET updated_at = created_at WHERE updated_at IS NULL;

UPDATE workflows SET graph = '' WHERE graph IS NULL;

UPDATE workflows SET features = '' WHERE features IS NULL;

ALTER TABLE workflows ALTER COLUMN graph SET NOT NULL;

ALTER TABLE workflows ALTER COLUMN features SET NOT NULL;

ALTER TABLE workflows ALTER COLUMN updated_at SET NOT NULL;

UPDATE alembic_version SET version_num='09a8d1878d9b' WHERE alembic_version.version_num = 'd07474999927';

-- Running upgrade 09a8d1878d9b -> 01d6889832f7

CREATE INDEX message_created_at_idx ON messages (created_at);

UPDATE alembic_version SET version_num='01d6889832f7' WHERE alembic_version.version_num = '09a8d1878d9b';

-- Running upgrade 01d6889832f7 -> cf8f4fc45278

ALTER TABLE workflow_runs ADD COLUMN exceptions_count INTEGER DEFAULT 0;

UPDATE alembic_version SET version_num='cf8f4fc45278' WHERE alembic_version.version_num = '01d6889832f7';

-- Running upgrade cf8f4fc45278 -> 11b07f66c737

DROP TABLE tool_providers;

UPDATE alembic_version SET version_num='11b07f66c737' WHERE alembic_version.version_num = 'cf8f4fc45278';

-- Running upgrade 11b07f66c737 -> e1944c35e15e

UPDATE alembic_version SET version_num='e1944c35e15e' WHERE alembic_version.version_num = '11b07f66c737';

-- Running upgrade e1944c35e15e -> d7999dfa4aae

-- Executing in offline mode: assuming the "retry_index" column does not exist.
-- The generated SQL may differ from what will actually be executed.
-- Please review the migration script carefully!;

UPDATE alembic_version SET version_num='d7999dfa4aae' WHERE alembic_version.version_num = 'e1944c35e15e';

-- Running upgrade d7999dfa4aae -> e19037032219

CREATE TABLE child_chunks (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    dataset_id UUID NOT NULL, 
    document_id UUID NOT NULL, 
    segment_id UUID NOT NULL, 
    position INTEGER NOT NULL, 
    content TEXT NOT NULL, 
    word_count INTEGER NOT NULL, 
    index_node_id VARCHAR(255), 
    index_node_hash VARCHAR(255), 
    type VARCHAR(255) DEFAULT 'automatic'::character varying NOT NULL, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_by UUID, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    indexing_at TIMESTAMP WITHOUT TIME ZONE, 
    completed_at TIMESTAMP WITHOUT TIME ZONE, 
    error TEXT, 
    CONSTRAINT child_chunk_pkey PRIMARY KEY (id)
);

CREATE INDEX child_chunk_dataset_id_idx ON child_chunks (tenant_id, dataset_id, document_id, segment_id, index_node_id);

UPDATE alembic_version SET version_num='e19037032219' WHERE alembic_version.version_num = 'd7999dfa4aae';

-- Running upgrade e19037032219 -> 923752d42eb6

CREATE TABLE dataset_auto_disable_logs (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    dataset_id UUID NOT NULL, 
    document_id UUID NOT NULL, 
    notified BOOLEAN DEFAULT false NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT dataset_auto_disable_log_pkey PRIMARY KEY (id)
);

CREATE INDEX dataset_auto_disable_log_created_atx ON dataset_auto_disable_logs (created_at);

CREATE INDEX dataset_auto_disable_log_dataset_idx ON dataset_auto_disable_logs (dataset_id);

CREATE INDEX dataset_auto_disable_log_tenant_idx ON dataset_auto_disable_logs (tenant_id);

UPDATE alembic_version SET version_num='923752d42eb6' WHERE alembic_version.version_num = 'e19037032219';

-- Running upgrade 923752d42eb6 -> a91b476a53de

ALTER TABLE workflow_runs ALTER COLUMN total_tokens TYPE BIGINT;

UPDATE alembic_version SET version_num='a91b476a53de' WHERE alembic_version.version_num = '923752d42eb6';

-- Running upgrade a91b476a53de -> ddcc8bbef391

ALTER TABLE tool_builtin_providers ALTER COLUMN provider TYPE VARCHAR(256);

UPDATE alembic_version SET version_num='ddcc8bbef391' WHERE alembic_version.version_num = 'a91b476a53de';

-- Running upgrade ddcc8bbef391 -> 08ec4f75af5e

CREATE TABLE account_plugin_permissions (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    install_permission VARCHAR(16) DEFAULT 'everyone' NOT NULL, 
    debug_permission VARCHAR(16) DEFAULT 'noone' NOT NULL, 
    CONSTRAINT account_plugin_permission_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_tenant_plugin UNIQUE (tenant_id)
);

UPDATE alembic_version SET version_num='08ec4f75af5e' WHERE alembic_version.version_num = 'ddcc8bbef391';

-- Running upgrade 08ec4f75af5e -> 4413929e1ec2

ALTER TABLE dataset_collection_bindings ALTER COLUMN provider_name TYPE VARCHAR(255);

UPDATE alembic_version SET version_num='4413929e1ec2' WHERE alembic_version.version_num = '08ec4f75af5e';

-- Running upgrade 4413929e1ec2 -> 5511c782ee4c

ALTER TABLE tool_api_providers ALTER COLUMN name TYPE VARCHAR(255);

ALTER TABLE tool_model_invokes ALTER COLUMN provider TYPE VARCHAR(255);

ALTER TABLE tool_workflow_providers ALTER COLUMN name TYPE VARCHAR(255);

UPDATE alembic_version SET version_num='5511c782ee4c' WHERE alembic_version.version_num = '4413929e1ec2';

-- Running upgrade 5511c782ee4c -> ee79d9b1c156

ALTER TABLE workflows ADD COLUMN marked_name VARCHAR DEFAULT '' NOT NULL;

ALTER TABLE workflows ADD COLUMN marked_comment VARCHAR DEFAULT '' NOT NULL;

UPDATE alembic_version SET version_num='ee79d9b1c156' WHERE alembic_version.version_num = '5511c782ee4c';

-- Running upgrade ee79d9b1c156 -> f051706725cc

CREATE TABLE rate_limit_logs (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    subscription_plan VARCHAR(255) NOT NULL, 
    operation VARCHAR(255) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT rate_limit_log_pkey PRIMARY KEY (id)
);

CREATE INDEX rate_limit_log_operation_idx ON rate_limit_logs (operation);

CREATE INDEX rate_limit_log_tenant_idx ON rate_limit_logs (tenant_id);

UPDATE alembic_version SET version_num='f051706725cc' WHERE alembic_version.version_num = 'ee79d9b1c156';

-- Running upgrade f051706725cc -> d20049ed0af6

CREATE TABLE dataset_metadata_bindings (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    dataset_id UUID NOT NULL, 
    metadata_id UUID NOT NULL, 
    document_id UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    created_by UUID NOT NULL, 
    CONSTRAINT dataset_metadata_binding_pkey PRIMARY KEY (id)
);

CREATE INDEX dataset_metadata_binding_dataset_idx ON dataset_metadata_bindings (dataset_id);

CREATE INDEX dataset_metadata_binding_document_idx ON dataset_metadata_bindings (document_id);

CREATE INDEX dataset_metadata_binding_metadata_idx ON dataset_metadata_bindings (metadata_id);

CREATE INDEX dataset_metadata_binding_tenant_idx ON dataset_metadata_bindings (tenant_id);

CREATE TABLE dataset_metadatas (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    dataset_id UUID NOT NULL, 
    type VARCHAR(255) NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    created_by UUID NOT NULL, 
    updated_by UUID, 
    CONSTRAINT dataset_metadata_pkey PRIMARY KEY (id)
);

CREATE INDEX dataset_metadata_dataset_idx ON dataset_metadatas (dataset_id);

CREATE INDEX dataset_metadata_tenant_idx ON dataset_metadatas (tenant_id);

ALTER TABLE datasets ADD COLUMN built_in_field_enabled BOOLEAN DEFAULT false NOT NULL;

ALTER TABLE documents ALTER COLUMN doc_metadata TYPE JSONB;

CREATE INDEX document_metadata_idx ON documents USING gin (doc_metadata);

UPDATE alembic_version SET version_num='d20049ed0af6' WHERE alembic_version.version_num = 'f051706725cc';

-- Running upgrade d20049ed0af6 -> 6a9f914f656c

CREATE INDEX child_chunks_node_idx ON child_chunks (index_node_id, dataset_id);

CREATE INDEX child_chunks_segment_idx ON child_chunks (segment_id);

DROP INDEX document_segment_dataset_node_idx;

CREATE INDEX document_segment_node_dataset_idx ON document_segments (index_node_id, dataset_id);

UPDATE alembic_version SET version_num='6a9f914f656c' WHERE alembic_version.version_num = 'd20049ed0af6';

-- Running upgrade 6a9f914f656c -> d28f2004b072

CREATE INDEX workflow_conversation_variables_conversation_id_idx ON workflow_conversation_variables (conversation_id);

UPDATE alembic_version SET version_num='d28f2004b072' WHERE alembic_version.version_num = '6a9f914f656c';

-- Running upgrade d28f2004b072 -> 2adcbe1f5dfb

CREATE TABLE workflow_draft_variables (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    app_id UUID NOT NULL, 
    last_edited_at TIMESTAMP WITHOUT TIME ZONE, 
    node_id VARCHAR(255) NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    description VARCHAR(255) NOT NULL, 
    selector VARCHAR(255) NOT NULL, 
    value_type VARCHAR(20) NOT NULL, 
    value TEXT NOT NULL, 
    visible BOOLEAN NOT NULL, 
    editable BOOLEAN NOT NULL, 
    CONSTRAINT workflow_draft_variables_pkey PRIMARY KEY (id), 
    CONSTRAINT workflow_draft_variables_app_id_key UNIQUE (app_id, node_id, name)
);

UPDATE alembic_version SET version_num='2adcbe1f5dfb' WHERE alembic_version.version_num = 'd28f2004b072';

-- Running upgrade 2adcbe1f5dfb -> 4474872b0ee6

COMMIT;

CREATE INDEX CONCURRENTLY workflow_node_executions_tenant_id_idx ON workflow_node_executions (tenant_id, workflow_id, node_id, created_at DESC);

BEGIN;

ALTER TABLE workflow_draft_variables ADD COLUMN node_execution_id UUID;

UPDATE alembic_version SET version_num='4474872b0ee6' WHERE alembic_version.version_num = '2adcbe1f5dfb';

-- Running upgrade 4474872b0ee6 -> 0ab65e1cc7fa

DROP INDEX workflow_run_tenant_app_sequence_idx;

ALTER TABLE workflow_runs DROP COLUMN sequence_number;

UPDATE alembic_version SET version_num='0ab65e1cc7fa' WHERE alembic_version.version_num = '4474872b0ee6';

-- Running upgrade 0ab65e1cc7fa -> 58eb7bdb93fe

CREATE TABLE app_mcp_servers (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    app_id UUID NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    description VARCHAR(255) NOT NULL, 
    server_code VARCHAR(255) NOT NULL, 
    status VARCHAR(255) DEFAULT 'normal'::character varying NOT NULL, 
    parameters TEXT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT app_mcp_server_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_app_mcp_server_tenant_app_id UNIQUE (tenant_id, app_id), 
    CONSTRAINT unique_app_mcp_server_server_code UNIQUE (server_code)
);

CREATE TABLE tool_mcp_providers (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    name VARCHAR(40) NOT NULL, 
    server_identifier VARCHAR(24) NOT NULL, 
    server_url TEXT NOT NULL, 
    server_url_hash VARCHAR(64) NOT NULL, 
    icon VARCHAR(255), 
    tenant_id UUID NOT NULL, 
    user_id UUID NOT NULL, 
    encrypted_credentials TEXT, 
    authed BOOLEAN NOT NULL, 
    tools TEXT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT tool_mcp_provider_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_mcp_provider_name UNIQUE (tenant_id, name), 
    CONSTRAINT unique_mcp_provider_server_identifier UNIQUE (tenant_id, server_identifier), 
    CONSTRAINT unique_mcp_provider_server_url UNIQUE (tenant_id, server_url_hash)
);

UPDATE alembic_version SET version_num='58eb7bdb93fe' WHERE alembic_version.version_num = '0ab65e1cc7fa';

-- Running upgrade 58eb7bdb93fe -> 1c9ba48be8e4

/* Main function to generate a uuidv7 value with millisecond precision */
CREATE FUNCTION uuidv7() RETURNS uuid
AS
$$
    -- Replace the first 48 bits of a uuidv4 with the current
    -- number of milliseconds since 1970-01-01 UTC
    -- and set the "ver" field to 7 by setting additional bits
SELECT encode(
               set_bit(
                       set_bit(
                               overlay(uuid_send(gen_random_uuid()) placing
                                       substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from
                                                 3)
                                       from 1 for 6),
                               52, 1),
                       53, 1), 'hex')::uuid;
$$ LANGUAGE SQL VOLATILE PARALLEL SAFE;

COMMENT ON FUNCTION uuidv7 IS
    'Generate a uuid-v7 value with a 48-bit timestamp (millisecond precision) and 74 bits of randomness';;

CREATE FUNCTION uuidv7_boundary(timestamptz) RETURNS uuid
AS
$$
    /* uuid fields: version=0b0111, variant=0b10 */
SELECT encode(
               overlay('\x00000000000070008000000000000000'::bytea
                       placing substring(int8send(floor(extract(epoch from $1) * 1000)::bigint) from 3)
                       from 1 for 6),
               'hex')::uuid;
$$ LANGUAGE SQL STABLE STRICT PARALLEL SAFE;

COMMENT ON FUNCTION uuidv7_boundary(timestamptz) IS
    'Generate a non-random uuidv7 with the given timestamp (first 48 bits) and all random bits to 0. As the smallest possible uuidv7 for that timestamp, it may be used as a boundary for partitions.';;

UPDATE alembic_version SET version_num='1c9ba48be8e4' WHERE alembic_version.version_num = '58eb7bdb93fe';

-- Running upgrade 1c9ba48be8e4 -> 71f5020c6470

CREATE TABLE tool_oauth_system_clients (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    plugin_id VARCHAR(512) NOT NULL, 
    provider VARCHAR(255) NOT NULL, 
    encrypted_oauth_params TEXT NOT NULL, 
    CONSTRAINT tool_oauth_system_client_pkey PRIMARY KEY (id), 
    CONSTRAINT tool_oauth_system_client_plugin_id_provider_idx UNIQUE (plugin_id, provider)
);

CREATE TABLE tool_oauth_tenant_clients (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    plugin_id VARCHAR(512) NOT NULL, 
    provider VARCHAR(255) NOT NULL, 
    enabled BOOLEAN DEFAULT true NOT NULL, 
    encrypted_oauth_params TEXT NOT NULL, 
    CONSTRAINT tool_oauth_tenant_client_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_tool_oauth_tenant_client UNIQUE (tenant_id, plugin_id, provider)
);

ALTER TABLE tool_builtin_providers ADD COLUMN name VARCHAR(256) DEFAULT 'API KEY 1'::character varying NOT NULL;

ALTER TABLE tool_builtin_providers ADD COLUMN is_default BOOLEAN DEFAULT false NOT NULL;

ALTER TABLE tool_builtin_providers ADD COLUMN credential_type VARCHAR(32) DEFAULT 'api-key'::character varying NOT NULL;

ALTER TABLE tool_builtin_providers DROP CONSTRAINT unique_builtin_tool_provider;

ALTER TABLE tool_builtin_providers ADD CONSTRAINT unique_builtin_tool_provider UNIQUE (tenant_id, provider, name);

UPDATE alembic_version SET version_num='71f5020c6470' WHERE alembic_version.version_num = '1c9ba48be8e4';

-- Running upgrade 71f5020c6470 -> 1a83934ad6d1

ALTER TABLE tool_mcp_providers ALTER COLUMN server_identifier TYPE VARCHAR(64);

ALTER TABLE tool_model_invokes ALTER COLUMN tool_name TYPE VARCHAR(128);

UPDATE alembic_version SET version_num='1a83934ad6d1' WHERE alembic_version.version_num = '71f5020c6470';

-- Running upgrade 1a83934ad6d1 -> 375fe79ead14

ALTER TABLE tool_builtin_providers ADD COLUMN expires_at BIGINT DEFAULT -1 NOT NULL;

UPDATE alembic_version SET version_num='375fe79ead14' WHERE alembic_version.version_num = '1a83934ad6d1';

-- Running upgrade 375fe79ead14 -> 8bcc02c9bd07

CREATE TABLE tenant_plugin_auto_upgrade_strategies (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    strategy_setting VARCHAR(16) DEFAULT 'fix_only' NOT NULL, 
    upgrade_time_of_day INTEGER NOT NULL, 
    upgrade_mode VARCHAR(16) DEFAULT 'exclude' NOT NULL, 
    exclude_plugins VARCHAR(255)[] NOT NULL, 
    include_plugins VARCHAR(255)[] NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT tenant_plugin_auto_upgrade_strategy_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_tenant_plugin_auto_upgrade_strategy UNIQUE (tenant_id)
);

UPDATE alembic_version SET version_num='8bcc02c9bd07' WHERE alembic_version.version_num = '375fe79ead14';

-- Running upgrade 8bcc02c9bd07 -> 532b3f888abf

ALTER TABLE tidb_auth_bindings ALTER COLUMN status SET DEFAULT 'CREATING'::character varying;

UPDATE alembic_version SET version_num='532b3f888abf' WHERE alembic_version.version_num = '8bcc02c9bd07';

-- Running upgrade 532b3f888abf -> fa8b0fa6f407

ALTER TABLE tool_mcp_providers ADD COLUMN timeout FLOAT DEFAULT 30 NOT NULL;

ALTER TABLE tool_mcp_providers ADD COLUMN sse_read_timeout FLOAT DEFAULT 300 NOT NULL;

UPDATE alembic_version SET version_num='fa8b0fa6f407' WHERE alembic_version.version_num = '532b3f888abf';

-- Running upgrade fa8b0fa6f407 -> e8446f481c1e

CREATE TABLE provider_credentials (
    id UUID DEFAULT uuidv7() NOT NULL, 
    tenant_id UUID NOT NULL, 
    provider_name VARCHAR(255) NOT NULL, 
    credential_name VARCHAR(255) NOT NULL, 
    encrypted_config TEXT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT provider_credential_pkey PRIMARY KEY (id)
);

CREATE INDEX provider_credential_tenant_provider_idx ON provider_credentials (tenant_id, provider_name);

ALTER TABLE providers ADD COLUMN credential_id UUID;

ALTER TABLE load_balancing_model_configs ADD COLUMN credential_id UUID;

-- [IMPORTANT] Data migration skipped!!!
-- You should manually run data migration function `migrate_existing_providers_data`
-- inside file /Users/qg/workspace/langgenius/dify/api/migrations/versions/2025_08_09_1553-e8446f481c1e_add_provider_credential_pool_support.py
-- Please review the migration script carefully!;

ALTER TABLE providers DROP COLUMN encrypted_config;

UPDATE alembic_version SET version_num='e8446f481c1e' WHERE alembic_version.version_num = 'fa8b0fa6f407';

-- Running upgrade e8446f481c1e -> 0e154742a5fa

CREATE TABLE provider_model_credentials (
    id UUID DEFAULT uuidv7() NOT NULL, 
    tenant_id UUID NOT NULL, 
    provider_name VARCHAR(255) NOT NULL, 
    model_name VARCHAR(255) NOT NULL, 
    model_type VARCHAR(40) NOT NULL, 
    credential_name VARCHAR(255) NOT NULL, 
    encrypted_config TEXT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT provider_model_credential_pkey PRIMARY KEY (id)
);

CREATE INDEX provider_model_credential_tenant_provider_model_idx ON provider_model_credentials (tenant_id, provider_name, model_name, model_type);

ALTER TABLE provider_models ADD COLUMN credential_id UUID;

ALTER TABLE load_balancing_model_configs ADD COLUMN credential_source_type VARCHAR(40);

-- [IMPORTANT] Data migration skipped!!!
-- You should manually run data migration function `migrate_existing_provider_models_data`
-- inside file /Users/qg/workspace/langgenius/dify/api/migrations/versions/2025_08_13_1605-0e154742a5fa_add_provider_model_multi_credential.py
-- Please review the migration script carefully!;

ALTER TABLE provider_models DROP COLUMN encrypted_config;

UPDATE alembic_version SET version_num='0e154742a5fa' WHERE alembic_version.version_num = 'e8446f481c1e';

-- Running upgrade 0e154742a5fa -> 8d289573e1da

CREATE TABLE oauth_provider_apps (
    id UUID DEFAULT uuidv7() NOT NULL, 
    app_icon VARCHAR(255) NOT NULL, 
    app_label JSON DEFAULT '{}' NOT NULL, 
    client_id VARCHAR(255) NOT NULL, 
    client_secret VARCHAR(255) NOT NULL, 
    redirect_uris JSON DEFAULT '[]' NOT NULL, 
    scope VARCHAR(255) DEFAULT 'read:name read:email read:avatar read:interface_language read:timezone' NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP(0) NOT NULL, 
    CONSTRAINT oauth_provider_app_pkey PRIMARY KEY (id)
);

CREATE INDEX oauth_provider_app_client_id_idx ON oauth_provider_apps (client_id);

UPDATE alembic_version SET version_num='8d289573e1da' WHERE alembic_version.version_num = '0e154742a5fa';

-- Running upgrade 8d289573e1da -> b95962a3885c

CREATE INDEX workflow_app_log_workflow_run_id_idx ON workflow_app_logs (workflow_run_id);

UPDATE alembic_version SET version_num='b95962a3885c' WHERE alembic_version.version_num = '8d289573e1da';

-- Running upgrade b95962a3885c -> c20211f18133

ALTER TABLE tool_mcp_providers ADD COLUMN encrypted_headers TEXT;

UPDATE alembic_version SET version_num='c20211f18133' WHERE alembic_version.version_num = 'b95962a3885c';

-- Running upgrade c20211f18133 -> cf7c38a32b2d

ALTER TABLE providers ADD COLUMN credential_status VARCHAR(20) DEFAULT 'active'::character varying;

UPDATE alembic_version SET version_num='cf7c38a32b2d' WHERE alembic_version.version_num = 'c20211f18133';

-- Running upgrade cf7c38a32b2d -> 68519ad5cd18

CREATE TABLE datasource_oauth_params (
    id UUID DEFAULT uuidv7() NOT NULL, 
    plugin_id VARCHAR(255) NOT NULL, 
    provider VARCHAR(255) NOT NULL, 
    system_credentials JSONB NOT NULL, 
    CONSTRAINT datasource_oauth_config_pkey PRIMARY KEY (id), 
    CONSTRAINT datasource_oauth_config_datasource_id_provider_idx UNIQUE (plugin_id, provider)
);

CREATE TABLE datasource_oauth_tenant_params (
    id UUID DEFAULT uuidv7() NOT NULL, 
    tenant_id UUID NOT NULL, 
    provider VARCHAR(255) NOT NULL, 
    plugin_id VARCHAR(255) NOT NULL, 
    client_params JSONB NOT NULL, 
    enabled BOOLEAN NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT datasource_oauth_tenant_config_pkey PRIMARY KEY (id), 
    CONSTRAINT datasource_oauth_tenant_config_unique UNIQUE (tenant_id, plugin_id, provider)
);

CREATE TABLE datasource_providers (
    id UUID DEFAULT uuidv7() NOT NULL, 
    tenant_id UUID NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    provider VARCHAR(255) NOT NULL, 
    plugin_id VARCHAR(255) NOT NULL, 
    auth_type VARCHAR(255) NOT NULL, 
    encrypted_credentials JSONB NOT NULL, 
    avatar_url TEXT, 
    is_default BOOLEAN DEFAULT false NOT NULL, 
    expires_at INTEGER DEFAULT '-1' NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT datasource_provider_pkey PRIMARY KEY (id), 
    CONSTRAINT datasource_provider_unique_name UNIQUE (tenant_id, plugin_id, provider, name)
);

CREATE INDEX datasource_provider_auth_type_provider_idx ON datasource_providers (tenant_id, plugin_id, provider);

CREATE TABLE document_pipeline_execution_logs (
    id UUID DEFAULT uuidv7() NOT NULL, 
    pipeline_id UUID NOT NULL, 
    document_id UUID NOT NULL, 
    datasource_type VARCHAR(255) NOT NULL, 
    datasource_info TEXT NOT NULL, 
    datasource_node_id VARCHAR(255) NOT NULL, 
    input_data JSON NOT NULL, 
    created_by UUID, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT document_pipeline_execution_log_pkey PRIMARY KEY (id)
);

CREATE INDEX document_pipeline_execution_logs_document_id_idx ON document_pipeline_execution_logs (document_id);

CREATE TABLE pipeline_built_in_templates (
    id UUID DEFAULT uuidv7() NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    description TEXT NOT NULL, 
    chunk_structure VARCHAR(255) NOT NULL, 
    icon JSON NOT NULL, 
    yaml_content TEXT NOT NULL, 
    copyright VARCHAR(255) NOT NULL, 
    privacy_policy VARCHAR(255) NOT NULL, 
    position INTEGER NOT NULL, 
    install_count INTEGER NOT NULL, 
    language VARCHAR(255) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    created_by UUID NOT NULL, 
    updated_by UUID, 
    CONSTRAINT pipeline_built_in_template_pkey PRIMARY KEY (id)
);

CREATE TABLE pipeline_customized_templates (
    id UUID DEFAULT uuidv7() NOT NULL, 
    tenant_id UUID NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    description TEXT NOT NULL, 
    chunk_structure VARCHAR(255) NOT NULL, 
    icon JSON NOT NULL, 
    position INTEGER NOT NULL, 
    yaml_content TEXT NOT NULL, 
    install_count INTEGER NOT NULL, 
    language VARCHAR(255) NOT NULL, 
    created_by UUID NOT NULL, 
    updated_by UUID, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT pipeline_customized_template_pkey PRIMARY KEY (id)
);

CREATE INDEX pipeline_customized_template_tenant_idx ON pipeline_customized_templates (tenant_id);

CREATE TABLE pipeline_recommended_plugins (
    id UUID DEFAULT uuidv7() NOT NULL, 
    plugin_id TEXT NOT NULL, 
    provider_name TEXT NOT NULL, 
    position INTEGER NOT NULL, 
    active BOOLEAN NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT pipeline_recommended_plugin_pkey PRIMARY KEY (id)
);

CREATE TABLE pipelines (
    id UUID DEFAULT uuidv7() NOT NULL, 
    tenant_id UUID NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    description TEXT DEFAULT ''::character varying NOT NULL, 
    workflow_id UUID, 
    is_public BOOLEAN DEFAULT false NOT NULL, 
    is_published BOOLEAN DEFAULT false NOT NULL, 
    created_by UUID, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_by UUID, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT pipeline_pkey PRIMARY KEY (id)
);

CREATE TABLE workflow_draft_variable_files (
    id UUID DEFAULT uuidv7() NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    tenant_id UUID NOT NULL, 
    app_id UUID NOT NULL, 
    user_id UUID NOT NULL, 
    upload_file_id UUID NOT NULL, 
    size BIGINT NOT NULL, 
    length INTEGER, 
    value_type VARCHAR(20) NOT NULL, 
    CONSTRAINT workflow_draft_variable_files_pkey PRIMARY KEY (id)
);

COMMENT ON COLUMN workflow_draft_variable_files.tenant_id IS 'The tenant to which the WorkflowDraftVariableFile belongs, referencing Tenant.id';

COMMENT ON COLUMN workflow_draft_variable_files.app_id IS 'The application to which the WorkflowDraftVariableFile belongs, referencing App.id';

COMMENT ON COLUMN workflow_draft_variable_files.user_id IS 'The owner to of the WorkflowDraftVariableFile, referencing Account.id';

COMMENT ON COLUMN workflow_draft_variable_files.upload_file_id IS 'Reference to UploadFile containing the large variable data';

COMMENT ON COLUMN workflow_draft_variable_files.size IS 'Size of the original variable content in bytes';

COMMENT ON COLUMN workflow_draft_variable_files.length IS 'Length of the original variable content. For array and array-like types, this represents the number of elements. For object types, it indicates the number of keys. For other types, the value is NULL.';

CREATE TABLE workflow_node_execution_offload (
    id UUID DEFAULT uuidv7() NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    tenant_id UUID NOT NULL, 
    app_id UUID NOT NULL, 
    node_execution_id UUID, 
    type VARCHAR(20) NOT NULL, 
    file_id UUID NOT NULL, 
    CONSTRAINT workflow_node_execution_offload_pkey PRIMARY KEY (id), 
    CONSTRAINT workflow_node_execution_offload_node_execution_id_key UNIQUE (node_execution_id, type)
);

ALTER TABLE datasets ADD COLUMN keyword_number INTEGER DEFAULT 10;

ALTER TABLE datasets ADD COLUMN icon_info JSONB;

ALTER TABLE datasets ADD COLUMN runtime_mode VARCHAR(255) DEFAULT 'general'::character varying;

ALTER TABLE datasets ADD COLUMN pipeline_id UUID;

ALTER TABLE datasets ADD COLUMN chunk_structure VARCHAR(255);

ALTER TABLE datasets ADD COLUMN enable_api BOOLEAN DEFAULT true NOT NULL;

ALTER TABLE workflow_draft_variables ADD COLUMN file_id UUID;

COMMENT ON COLUMN workflow_draft_variables.file_id IS 'Reference to WorkflowDraftVariableFile if variable is offloaded to external storage';

ALTER TABLE workflow_draft_variables ADD COLUMN is_default_value BOOLEAN DEFAULT FALSE NOT NULL;

COMMENT ON COLUMN workflow_draft_variables.is_default_value IS 'Indicates whether the current value is the default for a conversation variable. Always `FALSE` for other types of variables.';

CREATE INDEX workflow_draft_variable_file_id_idx ON workflow_draft_variables (file_id);

ALTER TABLE workflows ADD COLUMN rag_pipeline_variables TEXT DEFAULT '{}' NOT NULL;

UPDATE alembic_version SET version_num='68519ad5cd18' WHERE alembic_version.version_num = 'cf7c38a32b2d';

-- Running upgrade 68519ad5cd18 -> d98acf217d43

ALTER TABLE messages ADD COLUMN app_mode VARCHAR(255);

CREATE INDEX message_app_mode_idx ON messages (app_mode);

UPDATE alembic_version SET version_num='d98acf217d43' WHERE alembic_version.version_num = '68519ad5cd18';

-- Running upgrade d98acf217d43 -> ae662b25d9bc

ALTER TABLE pipeline_built_in_templates DROP COLUMN updated_by;

ALTER TABLE pipeline_built_in_templates DROP COLUMN created_by;

UPDATE alembic_version SET version_num='ae662b25d9bc' WHERE alembic_version.version_num = 'd98acf217d43';

-- Running upgrade ae662b25d9bc -> 03f8dcbc611e

CREATE TABLE workflow_pauses (
    workflow_id UUID NOT NULL, 
    workflow_run_id UUID NOT NULL, 
    resumed_at TIMESTAMP WITHOUT TIME ZONE, 
    state_object_key VARCHAR(255) NOT NULL, 
    id UUID DEFAULT uuidv7() NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT workflow_pauses_pkey PRIMARY KEY (id), 
    CONSTRAINT workflow_pauses_workflow_run_id_key UNIQUE (workflow_run_id)
);

UPDATE alembic_version SET version_num='03f8dcbc611e' WHERE alembic_version.version_num = 'ae662b25d9bc';

-- Running upgrade 03f8dcbc611e -> 669ffd70119c

CREATE TABLE app_triggers (
    id UUID DEFAULT uuidv7() NOT NULL, 
    tenant_id UUID NOT NULL, 
    app_id UUID NOT NULL, 
    node_id VARCHAR(64) NOT NULL, 
    trigger_type VARCHAR(50) NOT NULL, 
    title VARCHAR(255) NOT NULL, 
    provider_name VARCHAR(255) DEFAULT '', 
    status VARCHAR(50) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    CONSTRAINT app_trigger_pkey PRIMARY KEY (id)
);

CREATE INDEX app_trigger_tenant_app_idx ON app_triggers (tenant_id, app_id);

CREATE TABLE trigger_oauth_system_clients (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    plugin_id VARCHAR(512) NOT NULL, 
    provider VARCHAR(255) NOT NULL, 
    encrypted_oauth_params TEXT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT trigger_oauth_system_client_pkey PRIMARY KEY (id), 
    CONSTRAINT trigger_oauth_system_client_plugin_id_provider_idx UNIQUE (plugin_id, provider)
);

CREATE TABLE trigger_oauth_tenant_clients (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    plugin_id VARCHAR(255) NOT NULL, 
    provider VARCHAR(255) NOT NULL, 
    enabled BOOLEAN DEFAULT true NOT NULL, 
    encrypted_oauth_params TEXT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT trigger_oauth_tenant_client_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_trigger_oauth_tenant_client UNIQUE (tenant_id, plugin_id, provider)
);

CREATE TABLE trigger_subscriptions (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    tenant_id UUID NOT NULL, 
    user_id UUID NOT NULL, 
    provider_id VARCHAR(255) NOT NULL, 
    endpoint_id VARCHAR(255) NOT NULL, 
    parameters JSON NOT NULL, 
    properties JSON NOT NULL, 
    credentials JSON NOT NULL, 
    credential_type VARCHAR(50) NOT NULL, 
    credential_expires_at INTEGER NOT NULL, 
    expires_at INTEGER NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT trigger_provider_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_trigger_provider UNIQUE (tenant_id, provider_id, name)
);

COMMENT ON COLUMN trigger_subscriptions.name IS 'Subscription instance name';

COMMENT ON COLUMN trigger_subscriptions.provider_id IS 'Provider identifier (e.g., plugin_id/provider_name)';

COMMENT ON COLUMN trigger_subscriptions.endpoint_id IS 'Subscription endpoint';

COMMENT ON COLUMN trigger_subscriptions.parameters IS 'Subscription parameters JSON';

COMMENT ON COLUMN trigger_subscriptions.properties IS 'Subscription properties JSON';

COMMENT ON COLUMN trigger_subscriptions.credentials IS 'Subscription credentials JSON';

COMMENT ON COLUMN trigger_subscriptions.credential_type IS 'oauth or api_key';

COMMENT ON COLUMN trigger_subscriptions.credential_expires_at IS 'OAuth token expiration timestamp, -1 for never';

COMMENT ON COLUMN trigger_subscriptions.expires_at IS 'Subscription instance expiration timestamp, -1 for never';

CREATE UNIQUE INDEX idx_trigger_providers_endpoint ON trigger_subscriptions (endpoint_id);

CREATE INDEX idx_trigger_providers_tenant_endpoint ON trigger_subscriptions (tenant_id, endpoint_id);

CREATE INDEX idx_trigger_providers_tenant_provider ON trigger_subscriptions (tenant_id, provider_id);

CREATE TABLE workflow_plugin_triggers (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    node_id VARCHAR(64) NOT NULL, 
    tenant_id UUID NOT NULL, 
    provider_id VARCHAR(512) NOT NULL, 
    event_name VARCHAR(255) NOT NULL, 
    subscription_id VARCHAR(255) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT workflow_plugin_trigger_pkey PRIMARY KEY (id), 
    CONSTRAINT uniq_app_node_subscription UNIQUE (app_id, node_id)
);

CREATE INDEX workflow_plugin_trigger_tenant_subscription_idx ON workflow_plugin_triggers (tenant_id, subscription_id, event_name);

CREATE TABLE workflow_schedule_plans (
    id UUID DEFAULT uuidv7() NOT NULL, 
    app_id UUID NOT NULL, 
    node_id VARCHAR(64) NOT NULL, 
    tenant_id UUID NOT NULL, 
    cron_expression VARCHAR(255) NOT NULL, 
    timezone VARCHAR(64) NOT NULL, 
    next_run_at TIMESTAMP WITHOUT TIME ZONE, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT workflow_schedule_plan_pkey PRIMARY KEY (id), 
    CONSTRAINT uniq_app_node UNIQUE (app_id, node_id)
);

CREATE INDEX workflow_schedule_plan_next_idx ON workflow_schedule_plans (next_run_at);

CREATE TABLE workflow_trigger_logs (
    id UUID DEFAULT uuidv7() NOT NULL, 
    tenant_id UUID NOT NULL, 
    app_id UUID NOT NULL, 
    workflow_id UUID NOT NULL, 
    workflow_run_id UUID, 
    root_node_id VARCHAR(255), 
    trigger_metadata TEXT NOT NULL, 
    trigger_type VARCHAR(50) NOT NULL, 
    trigger_data TEXT NOT NULL, 
    inputs TEXT NOT NULL, 
    outputs TEXT, 
    status VARCHAR(50) NOT NULL, 
    error TEXT, 
    queue_name VARCHAR(100) NOT NULL, 
    celery_task_id VARCHAR(255), 
    retry_count INTEGER NOT NULL, 
    elapsed_time FLOAT, 
    total_tokens INTEGER, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    created_by_role VARCHAR(255) NOT NULL, 
    created_by VARCHAR(255) NOT NULL, 
    triggered_at TIMESTAMP WITHOUT TIME ZONE, 
    finished_at TIMESTAMP WITHOUT TIME ZONE, 
    CONSTRAINT workflow_trigger_log_pkey PRIMARY KEY (id)
);

CREATE INDEX workflow_trigger_log_created_at_idx ON workflow_trigger_logs (created_at);

CREATE INDEX workflow_trigger_log_status_idx ON workflow_trigger_logs (status);

CREATE INDEX workflow_trigger_log_tenant_app_idx ON workflow_trigger_logs (tenant_id, app_id);

CREATE INDEX workflow_trigger_log_workflow_id_idx ON workflow_trigger_logs (workflow_id);

CREATE INDEX workflow_trigger_log_workflow_run_idx ON workflow_trigger_logs (workflow_run_id);

CREATE TABLE workflow_webhook_triggers (
    id UUID DEFAULT uuidv7() NOT NULL, 
    app_id UUID NOT NULL, 
    node_id VARCHAR(64) NOT NULL, 
    tenant_id UUID NOT NULL, 
    webhook_id VARCHAR(24) NOT NULL, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT workflow_webhook_trigger_pkey PRIMARY KEY (id), 
    CONSTRAINT uniq_node UNIQUE (app_id, node_id), 
    CONSTRAINT uniq_webhook_id UNIQUE (webhook_id)
);

CREATE INDEX workflow_webhook_trigger_tenant_idx ON workflow_webhook_triggers (tenant_id);

ALTER TABLE celery_taskmeta ALTER COLUMN task_id SET NOT NULL;

ALTER TABLE celery_taskmeta ALTER COLUMN status SET NOT NULL;

ALTER TABLE celery_tasksetmeta ALTER COLUMN taskset_id SET NOT NULL;

ALTER TABLE providers DROP COLUMN credential_status;

UPDATE alembic_version SET version_num='669ffd70119c' WHERE alembic_version.version_num = '03f8dcbc611e';

-- Running upgrade 669ffd70119c -> 09cfdda155d1

ALTER TABLE datasource_providers ALTER COLUMN provider TYPE VARCHAR(128);

ALTER TABLE external_knowledge_bindings ALTER COLUMN external_knowledge_id TYPE VARCHAR(512);

ALTER TABLE tenant_plugin_auto_upgrade_strategies ALTER COLUMN exclude_plugins TYPE JSON USING to_jsonb(exclude_plugins)::json;

ALTER TABLE tenant_plugin_auto_upgrade_strategies ALTER COLUMN include_plugins TYPE JSON USING to_jsonb(include_plugins)::json;

ALTER TABLE tool_oauth_tenant_clients ALTER COLUMN plugin_id TYPE VARCHAR(255);

ALTER TABLE trigger_oauth_system_clients ALTER COLUMN plugin_id TYPE VARCHAR(255);

UPDATE alembic_version SET version_num='09cfdda155d1' WHERE alembic_version.version_num = '669ffd70119c';

-- Running upgrade 09cfdda155d1 -> 7bb281b7a422

CREATE TABLE workflow_pause_reasons (
    id UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    pause_id UUID NOT NULL, 
    type_ VARCHAR(20) NOT NULL, 
    form_id VARCHAR(36) NOT NULL, 
    node_id VARCHAR(255) NOT NULL, 
    message VARCHAR(255) NOT NULL, 
    CONSTRAINT workflow_pause_reasons_pkey PRIMARY KEY (id)
);

CREATE INDEX workflow_pause_reasons_pause_id_idx ON workflow_pause_reasons (pause_id);

UPDATE alembic_version SET version_num='7bb281b7a422' WHERE alembic_version.version_num = '09cfdda155d1';

-- Running upgrade 7bb281b7a422 -> d57accd375ae

CREATE TABLE segment_attachment_bindings (
    id UUID NOT NULL, 
    tenant_id UUID NOT NULL, 
    dataset_id UUID NOT NULL, 
    document_id UUID NOT NULL, 
    segment_id UUID NOT NULL, 
    attachment_id UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT segment_attachment_binding_pkey PRIMARY KEY (id)
);

CREATE INDEX segment_attachment_binding_tenant_dataset_document_segment_idx ON segment_attachment_bindings (tenant_id, dataset_id, document_id, segment_id);

CREATE INDEX segment_attachment_binding_attachment_idx ON segment_attachment_bindings (attachment_id);

ALTER TABLE datasets ADD COLUMN is_multimodal BOOLEAN DEFAULT false NOT NULL;

UPDATE alembic_version SET version_num='d57accd375ae' WHERE alembic_version.version_num = '7bb281b7a422';

-- Running upgrade d57accd375ae -> 03ea244985ce

ALTER TABLE pipeline_recommended_plugins ADD COLUMN type VARCHAR(50) DEFAULT 'tool' NOT NULL;

UPDATE alembic_version SET version_num='03ea244985ce' WHERE alembic_version.version_num = 'd57accd375ae';

-- Running upgrade 03ea244985ce -> 7df29de0f6be

CREATE TABLE tenant_credit_pools (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    tenant_id UUID NOT NULL, 
    pool_type VARCHAR(40) DEFAULT 'trial' NOT NULL, 
    quota_limit BIGINT NOT NULL, 
    quota_used BIGINT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT tenant_credit_pool_pkey PRIMARY KEY (id)
);

CREATE INDEX tenant_credit_pool_pool_type_idx ON tenant_credit_pools (pool_type);

CREATE INDEX tenant_credit_pool_tenant_id_idx ON tenant_credit_pools (tenant_id);

UPDATE alembic_version SET version_num='7df29de0f6be' WHERE alembic_version.version_num = '03ea244985ce';

-- Running upgrade 7df29de0f6be -> 905527cc8fd3

CREATE INDEX workflow_run_created_at_id_idx ON workflow_runs (created_at, id);

UPDATE alembic_version SET version_num='905527cc8fd3' WHERE alembic_version.version_num = '7df29de0f6be';

-- Running upgrade 905527cc8fd3 -> 3334862ee907

CREATE INDEX message_created_at_id_idx ON messages (created_at, id);

UPDATE alembic_version SET version_num='3334862ee907' WHERE alembic_version.version_num = '905527cc8fd3';

-- Running upgrade 3334862ee907 -> 288345cd01d1

DROP INDEX workflow_node_execution_workflow_run_idx;

CREATE INDEX workflow_node_execution_workflow_run_id_idx ON workflow_node_executions (workflow_run_id);

UPDATE alembic_version SET version_num='288345cd01d1' WHERE alembic_version.version_num = '3334862ee907';

-- Running upgrade 288345cd01d1 -> 9e6fa5cbcd80

UPDATE message_annotations SET question=(SELECT coalesce(messages.query, '') AS coalesce_1 
FROM messages 
WHERE messages.id = message_annotations.message_id) WHERE message_annotations.question IS NULL AND message_annotations.message_id IS NOT NULL;

UPDATE message_annotations SET question='' WHERE message_annotations.question IS NULL;

ALTER TABLE message_annotations ALTER COLUMN question SET NOT NULL;

UPDATE alembic_version SET version_num='9e6fa5cbcd80' WHERE alembic_version.version_num = '288345cd01d1';

-- Running upgrade 9e6fa5cbcd80 -> f9f6d18a37f9

CREATE TABLE account_trial_app_records (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    account_id UUID NOT NULL, 
    app_id UUID NOT NULL, 
    count INTEGER NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT user_trial_app_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_account_trial_app_record UNIQUE (account_id, app_id)
);

CREATE INDEX account_trial_app_record_account_id_idx ON account_trial_app_records (account_id);

CREATE INDEX account_trial_app_record_app_id_idx ON account_trial_app_records (app_id);

CREATE TABLE exporle_banners (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    content JSON NOT NULL, 
    link VARCHAR(255) NOT NULL, 
    sort INTEGER NOT NULL, 
    status VARCHAR(255) DEFAULT 'enabled'::character varying NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    language VARCHAR(255) DEFAULT 'en-US'::character varying NOT NULL, 
    CONSTRAINT exporler_banner_pkey PRIMARY KEY (id)
);

CREATE TABLE trial_apps (
    id UUID DEFAULT uuid_generate_v4() NOT NULL, 
    app_id UUID NOT NULL, 
    tenant_id UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    trial_limit INTEGER NOT NULL, 
    CONSTRAINT trial_app_pkey PRIMARY KEY (id), 
    CONSTRAINT unique_trail_app_id UNIQUE (app_id)
);

CREATE INDEX trial_app_app_id_idx ON trial_apps (app_id);

CREATE INDEX trial_app_tenant_id_idx ON trial_apps (tenant_id);

UPDATE alembic_version SET version_num='f9f6d18a37f9' WHERE alembic_version.version_num = '9e6fa5cbcd80';

-- Running upgrade f9f6d18a37f9 -> 9d77545f524e

CREATE TABLE workflow_archive_logs (
    id UUID DEFAULT uuidv7() NOT NULL, 
    log_id UUID, 
    tenant_id UUID NOT NULL, 
    app_id UUID NOT NULL, 
    workflow_id UUID NOT NULL, 
    workflow_run_id UUID NOT NULL, 
    created_by_role VARCHAR(255) NOT NULL, 
    created_by UUID NOT NULL, 
    log_created_at TIMESTAMP WITHOUT TIME ZONE, 
    log_created_from VARCHAR(255), 
    run_version VARCHAR(255) NOT NULL, 
    run_status VARCHAR(255) NOT NULL, 
    run_triggered_from VARCHAR(255) NOT NULL, 
    run_error TEXT, 
    run_elapsed_time FLOAT DEFAULT 0 NOT NULL, 
    run_total_tokens BIGINT DEFAULT 0 NOT NULL, 
    run_total_steps INTEGER DEFAULT 0, 
    run_created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    run_finished_at TIMESTAMP WITHOUT TIME ZONE, 
    run_exceptions_count INTEGER DEFAULT 0, 
    trigger_metadata TEXT, 
    archived_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT workflow_archive_log_pkey PRIMARY KEY (id)
);

CREATE INDEX workflow_archive_log_app_idx ON workflow_archive_logs (tenant_id, app_id);

CREATE INDEX workflow_archive_log_run_created_at_idx ON workflow_archive_logs (run_created_at);

CREATE INDEX workflow_archive_log_workflow_run_id_idx ON workflow_archive_logs (workflow_run_id);

UPDATE alembic_version SET version_num='9d77545f524e' WHERE alembic_version.version_num = 'f9f6d18a37f9';

-- Running upgrade 9d77545f524e -> 788d3099ae3a

CREATE TABLE document_segment_summaries (
    id UUID NOT NULL, 
    dataset_id UUID NOT NULL, 
    document_id UUID NOT NULL, 
    chunk_id UUID NOT NULL, 
    summary_content TEXT, 
    summary_index_node_id VARCHAR(255), 
    summary_index_node_hash VARCHAR(255), 
    tokens INTEGER, 
    status VARCHAR(32) DEFAULT 'generating' NOT NULL, 
    error TEXT, 
    enabled BOOLEAN DEFAULT true NOT NULL, 
    disabled_at TIMESTAMP WITHOUT TIME ZONE, 
    disabled_by UUID, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    CONSTRAINT document_segment_summaries_pkey PRIMARY KEY (id)
);

CREATE INDEX document_segment_summaries_chunk_id_idx ON document_segment_summaries (chunk_id);

CREATE INDEX document_segment_summaries_dataset_id_idx ON document_segment_summaries (dataset_id);

CREATE INDEX document_segment_summaries_document_id_idx ON document_segment_summaries (document_id);

CREATE INDEX document_segment_summaries_status_idx ON document_segment_summaries (status);

ALTER TABLE datasets ADD COLUMN summary_index_setting JSONB;

ALTER TABLE documents ADD COLUMN need_summary BOOLEAN DEFAULT false NOT NULL;

UPDATE alembic_version SET version_num='788d3099ae3a' WHERE alembic_version.version_num = '9d77545f524e';

-- Running upgrade 788d3099ae3a -> e8c3b3c46151

CREATE TABLE execution_extra_contents (
    id UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    type VARCHAR(30) NOT NULL, 
    workflow_run_id UUID NOT NULL, 
    message_id UUID, 
    form_id UUID, 
    CONSTRAINT execution_extra_contents_pkey PRIMARY KEY (id)
);

CREATE INDEX execution_extra_contents_message_id_idx ON execution_extra_contents (message_id);

CREATE INDEX execution_extra_contents_workflow_run_id_idx ON execution_extra_contents (workflow_run_id);

CREATE TABLE human_input_form_deliveries (
    id UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    form_id UUID NOT NULL, 
    delivery_method_type VARCHAR(20) NOT NULL, 
    delivery_config_id UUID, 
    channel_payload TEXT NOT NULL, 
    CONSTRAINT human_input_form_deliveries_pkey PRIMARY KEY (id)
);

CREATE TABLE human_input_form_recipients (
    id UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    form_id UUID NOT NULL, 
    delivery_id UUID NOT NULL, 
    recipient_type VARCHAR(20) NOT NULL, 
    recipient_payload TEXT NOT NULL, 
    access_token VARCHAR(32) NOT NULL, 
    CONSTRAINT human_input_form_recipients_pkey PRIMARY KEY (id)
);

ALTER TABLE human_input_form_recipients ADD CONSTRAINT human_input_form_recipients_access_token_key UNIQUE (access_token);

CREATE TABLE human_input_forms (
    id UUID NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    tenant_id UUID NOT NULL, 
    app_id UUID NOT NULL, 
    workflow_run_id UUID, 
    form_kind VARCHAR(20) NOT NULL, 
    node_id VARCHAR(60) NOT NULL, 
    form_definition TEXT NOT NULL, 
    rendered_content TEXT NOT NULL, 
    status VARCHAR(20) NOT NULL, 
    expiration_time TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    selected_action_id VARCHAR(200), 
    submitted_data TEXT, 
    submitted_at TIMESTAMP WITHOUT TIME ZONE, 
    submission_user_id UUID, 
    submission_end_user_id UUID, 
    completed_by_recipient_id UUID, 
    CONSTRAINT human_input_forms_pkey PRIMARY KEY (id)
);

UPDATE alembic_version SET version_num='e8c3b3c46151' WHERE alembic_version.version_num = '788d3099ae3a';

COMMIT;


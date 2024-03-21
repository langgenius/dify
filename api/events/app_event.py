from blinker import signal

# sender: app
app_was_created = signal('app-was-created')

# sender: app
app_was_deleted = signal('app-was-deleted')

# sender: app, kwargs: app_model_config
app_model_config_was_updated = signal('app-model-config-was-updated')

# sender: app, kwargs: published_workflow
app_published_workflow_was_updated = signal('app-published-workflow-was-updated')

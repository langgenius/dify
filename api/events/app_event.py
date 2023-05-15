from blinker import signal

# sender: app
app_was_created = signal('app-was-created')

# sender: app
app_was_deleted = signal('app-was-deleted')

# sender: app, kwargs: old_app_model_config, new_app_model_config
app_model_config_was_updated = signal('app-model-config-was-updated')

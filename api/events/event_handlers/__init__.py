from .clean_when_dataset_deleted import handle as handle_clean_when_dataset_deleted
from .clean_when_document_deleted import handle as handle_clean_when_document_deleted
from .create_document_index import handle as handle_create_document_index
from .create_installed_app_when_app_created import handle as handle_create_installed_app_when_app_created
from .create_site_record_when_app_created import handle as handle_create_site_record_when_app_created
from .delete_tool_parameters_cache_when_sync_draft_workflow import (
    handle as handle_delete_tool_parameters_cache_when_sync_draft_workflow,
)
from .update_app_dataset_join_when_app_model_config_updated import (
    handle as handle_update_app_dataset_join_when_app_model_config_updated,
)
from .update_app_dataset_join_when_app_published_workflow_updated import (
    handle as handle_update_app_dataset_join_when_app_published_workflow_updated,
)

# Consolidated handler replaces both deduct_quota_when_message_created and
# update_provider_last_used_at_when_message_created
from .update_provider_when_message_created import handle as handle_update_provider_when_message_created

__all__ = [
    "handle_clean_when_dataset_deleted",
    "handle_clean_when_document_deleted",
    "handle_create_document_index",
    "handle_create_installed_app_when_app_created",
    "handle_create_site_record_when_app_created",
    "handle_delete_tool_parameters_cache_when_sync_draft_workflow",
    "handle_update_app_dataset_join_when_app_model_config_updated",
    "handle_update_app_dataset_join_when_app_published_workflow_updated",
    "handle_update_provider_when_message_created",
]

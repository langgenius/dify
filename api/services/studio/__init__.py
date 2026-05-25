"""
Studio service module.

This package identifies services that are primarily dedicated to Studio
(app management + workflow editing) functionality. In Phase 1, these
services remain in their original locations under api/services/ and are
re-exported here. Physical migration to this package is planned for Phase 2
after cross-cutting import analysis is complete.

Studio-dedicated services (used exclusively or primarily by Studio controllers):
    - workflow_service.py
    - workflow_run_service.py
    - workflow_app_service.py
    - workflow_comment_service.py
    - workflow_draft_variable_service.py
    - workflow_collaboration_service.py
    - annotation_service.py
    - app_model_config_service.py
    - agent_service.py
    - ops_service.py
    - advanced_prompt_template_service.py
    - feedback_service.py
    - workflow_event_snapshot_service.py
    - workflow_restore.py
    - agent/composer_service.py
    - agent/roster_service.py
    - agent/composer_validator.py
    - agent/errors.py

Services shared between Studio and Core (stay in api/services/):
    - app_service.py (used by Explore)
    - app_generate_service.py (used by Explore)
    - app_dsl_service.py (app import/export)
    - app_task_service.py (used by Explore)
    - audio_service.py (used by Explore)
    - conversation_service.py (used by Explore)
    - message_service.py (used by Explore)
    - async_workflow_service.py (used by plugin system, tasks)
"""

# Re-export Studio-dedicated services from their original locations
from services.advanced_prompt_template_service import AdvancedPromptTemplateService
from services.agent_service import AgentService
from services.annotation_service import AppAnnotationService
from services.app_model_config_service import AppModelConfigService
from services.feedback_service import FeedbackService
from services.ops_service import OpsService
from services.workflow_app_service import WorkflowAppService
from services.workflow_collaboration_service import WorkflowCollaborationService
from services.workflow_comment_service import WorkflowCommentService
from services.workflow_event_snapshot_service import build_workflow_event_stream
from services.workflow_restore import apply_published_workflow_snapshot_to_draft
from services.workflow_run_service import WorkflowRunService
from services.workflow_service import WorkflowService

__all__ = [
    "AdvancedPromptTemplateService",
    "AgentService",
    "AppAnnotationService",
    "AppModelConfigService",
    "FeedbackService",
    "OpsService",
    "WorkflowAppService",
    "WorkflowCollaborationService",
    "WorkflowCommentService",
    "WorkflowRunService",
    "WorkflowService",
    "apply_published_workflow_snapshot_to_draft",
    "build_workflow_event_stream",
]

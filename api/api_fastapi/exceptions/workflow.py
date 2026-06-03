"""Workflow exceptions for API v2 route contracts."""

from __future__ import annotations

from api_fastapi.exceptions.base import APIError


class AppNotFoundError(APIError):
    """Workflow app lookup failed within the authenticated tenant."""

    error_code = "app_not_found"
    description = "App not found."
    code = 404


class DraftWorkflowNotExistError(APIError):
    """Workflow canvas requested a draft that has not been initialized."""

    error_code = "draft_workflow_not_exist"
    description = "Draft workflow need to be initialized."
    code = 404


class DraftWorkflowNotSyncError(APIError):
    """Workflow canvas save failed optimistic concurrency validation."""

    error_code = "draft_workflow_not_sync"
    description = "Workflow graph might have been modified, please refresh and resubmit."
    code = 409

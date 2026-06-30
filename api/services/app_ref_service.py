"""Typed resource references for app ownership chains."""

from typing import NamedTuple

from models.model import App


class AppRef(NamedTuple):
    """App identifiers used to scope downstream resource lookups."""

    tenant_id: str
    app_id: str


class MessageRef(NamedTuple):
    """Message identifiers used to scope downstream resource lookups."""

    tenant_id: str
    app_id: str
    message_id: str
    end_user_id: str | None = None
    account_id: str | None = None


class AnnotationRef(NamedTuple):
    """Annotation identifiers used to scope downstream resource lookups."""

    tenant_id: str
    app_id: str
    annotation_id: str


class AppMCPServerRef(NamedTuple):
    """MCP server identifiers used to scope downstream resource lookups."""

    tenant_id: str
    app_id: str
    server_id: str


class AppRefService:
    """Factory helpers for app and child resource refs."""

    @staticmethod
    def create_app_ref(app: App) -> AppRef:
        return AppRef(tenant_id=app.tenant_id, app_id=app.id)

    @staticmethod
    def create_message_ref(
        app_ref: AppRef,
        message_id: str,
        *,
        end_user_id: str | None = None,
        account_id: str | None = None,
    ) -> MessageRef:
        return MessageRef(
            tenant_id=app_ref.tenant_id,
            app_id=app_ref.app_id,
            message_id=message_id,
            end_user_id=end_user_id,
            account_id=account_id,
        )

    @staticmethod
    def create_annotation_ref(app_ref: AppRef, annotation_id: str) -> AnnotationRef:
        return AnnotationRef(tenant_id=app_ref.tenant_id, app_id=app_ref.app_id, annotation_id=annotation_id)

    @staticmethod
    def create_mcp_server_ref(app_ref: AppRef, server_id: str) -> AppMCPServerRef:
        return AppMCPServerRef(tenant_id=app_ref.tenant_id, app_id=app_ref.app_id, server_id=server_id)

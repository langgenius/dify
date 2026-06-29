"""Typed resource references for app ownership chains."""

from typing import NamedTuple

from models.model import App

_APP_REF_CTOR_TOKEN = object()


class _AppRefBase(NamedTuple):
    tenant_id: str
    app_id: str
    ctor_token: object


class AppRef(_AppRefBase):
    """Tenant-scoped app reference with token-gated construction."""

    __slots__ = ()

    def __new__(cls, tenant_id: str, app_id: str, ctor_token: object) -> "AppRef":
        if ctor_token is not _APP_REF_CTOR_TOKEN:
            raise ValueError("AppRef must be created by AppRefService.")
        return super().__new__(cls, tenant_id, app_id, ctor_token)

    def __repr__(self) -> str:
        return f"AppRef(tenant_id={self.tenant_id!r}, app_id={self.app_id!r})"


class MessageRef(NamedTuple):
    """Message reference bound to a trusted app reference."""

    app: AppRef
    message_id: str
    end_user_id: str | None = None
    account_id: str | None = None

    @property
    def tenant_id(self) -> str:
        return self.app.tenant_id

    @property
    def app_id(self) -> str:
        return self.app.app_id


class AnnotationRef(NamedTuple):
    """Annotation reference bound to a trusted app reference."""

    app: AppRef
    annotation_id: str

    @property
    def tenant_id(self) -> str:
        return self.app.tenant_id

    @property
    def app_id(self) -> str:
        return self.app.app_id


class AppMCPServerRef(NamedTuple):
    """MCP server reference bound to a trusted app reference."""

    app: AppRef
    server_id: str

    @property
    def tenant_id(self) -> str:
        return self.app.tenant_id

    @property
    def app_id(self) -> str:
        return self.app.app_id


class AppRefService:
    """Factory for trusted app and child resource refs."""

    @staticmethod
    def create_app_ref(app: App) -> AppRef:
        return AppRef(app.tenant_id, app.id, _APP_REF_CTOR_TOKEN)

    @staticmethod
    def create_message_ref(
        app_ref: AppRef,
        message_id: str,
        *,
        end_user_id: str | None = None,
        account_id: str | None = None,
    ) -> MessageRef:
        return MessageRef(app=app_ref, message_id=message_id, end_user_id=end_user_id, account_id=account_id)

    @staticmethod
    def create_annotation_ref(app_ref: AppRef, annotation_id: str) -> AnnotationRef:
        return AnnotationRef(app=app_ref, annotation_id=annotation_id)

    @staticmethod
    def create_mcp_server_ref(app_ref: AppRef, server_id: str) -> AppMCPServerRef:
        return AppMCPServerRef(app=app_ref, server_id=server_id)

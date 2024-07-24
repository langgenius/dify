from contextvars import ContextVar

tenant_id: ContextVar[str] = ContextVar('tenant_id')
from contextvars import ContextVar

from models.account import Account

current_user: ContextVar[Account] = ContextVar('current_user')
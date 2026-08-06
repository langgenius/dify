"""Concrete Provider adapters for Human Input IM integrations."""

from .dingtalk import DingTalkIMProviderAdapter
from .slack import SlackIMProviderAdapter

__all__ = ["DingTalkIMProviderAdapter", "SlackIMProviderAdapter"]

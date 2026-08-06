"""Concrete Provider adapters for Human Input IM integrations."""

from .ms_teams import MSTeamsIMProviderAdapter
from .slack import SlackIMProviderAdapter

__all__ = ["MSTeamsIMProviderAdapter", "SlackIMProviderAdapter"]

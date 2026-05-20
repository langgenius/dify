"""Compatibility import for the core plugin service.

PluginService lives in ``core.plugin`` because provider discovery, plugin
lifecycle changes, and cache ownership are core plugin concerns. Keep this
module as an alias so existing imports and test patch paths continue to target
the same module object.
"""

from __future__ import annotations

import sys

from core.plugin import plugin_service as _plugin_service
from core.plugin.plugin_service import *  # noqa: F403

sys.modules[__name__] = _plugin_service

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

import httpx
from werkzeug.exceptions import BadRequest

from controllers.openapi._errors import MarketplaceUnavailable, PluginInstallForbidden, PluginServiceUnavailable
from core.plugin.impl.exc import PluginDaemonClientSideError, PluginDaemonInternalError
from services.errors.plugin import PluginInstallationForbiddenError


@contextmanager
def plugin_errors() -> Generator[None]:
    try:
        yield
    except PluginInstallationForbiddenError as error:
        raise PluginInstallForbidden(str(error)) from error
    except PluginDaemonClientSideError as error:
        raise BadRequest(error.description) from error
    except PluginDaemonInternalError as error:
        raise PluginServiceUnavailable() from error
    except httpx.HTTPError as error:
        # The daemon client wraps its own transport errors, so a raw httpx error comes from the marketplace.
        raise MarketplaceUnavailable() from error

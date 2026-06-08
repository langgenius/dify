from typing import Any, cast

import socketio  # type: ignore[reportMissingTypeStubs]

from configs import dify_config

# TODO: FIXME(chariri) - Casting to any because app_factory attaches the
# current app as the `app` attribute on this - Bad.
sio = cast(Any, socketio.Server(async_mode="gevent", cors_allowed_origins=dify_config.CONSOLE_CORS_ALLOW_ORIGINS))

from typing import Any

from libs.generative_ui import generative_ui_enabled


class GenerativeUIConfigManager:
    @classmethod
    def convert(cls, config: dict[str, Any]) -> bool:
        """Return whether Generative UI is enabled in an app model config mapping.

        Preconditions: ``config`` is a mapping loaded from an app model config.
        Postconditions: returns ``True`` only when ``config["generative_ui"]`` enables it.
        """
        return generative_ui_enabled(config.get("generative_ui"))

    @classmethod
    def validate_and_set_defaults(cls, config: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
        """Validate and normalize the ``generative_ui`` feature toggle in-place.

        Preconditions: ``config`` is a mutable app model config dictionary.
        Postconditions: ``config["generative_ui"]`` is ``{"enabled": bool}`` and
            ``["generative_ui"]`` is returned as the validated key list.
        """
        raw = config.get("generative_ui")
        if not raw:
            config["generative_ui"] = {"enabled": False}
        elif not isinstance(raw, dict):
            raise ValueError("generative_ui must be of dict type")
        else:
            enabled = raw.get("enabled", False)
            if not isinstance(enabled, bool):
                raise ValueError("enabled in generative_ui must be of boolean type")
            config["generative_ui"] = {"enabled": enabled}

        return config, ["generative_ui"]

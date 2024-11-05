from threading import Lock
from time import time
from typing import Optional

from requests.adapters import HTTPAdapter
from requests.exceptions import ConnectionError, MissingSchema, Timeout
from requests.sessions import Session
from yarl import URL


class XinferenceModelExtraParameter:
    model_format: str
    model_handle_type: str
    model_ability: list[str]
    max_tokens: int = 512
    context_length: int = 2048
    support_function_call: bool = False
    support_vision: bool = False
    model_family: Optional[str]

    def __init__(
        self,
        model_format: str,
        model_handle_type: str,
        model_ability: list[str],
        support_function_call: bool,
        support_vision: bool,
        max_tokens: int,
        context_length: int,
        model_family: Optional[str],
    ) -> None:
        self.model_format = model_format
        self.model_handle_type = model_handle_type
        self.model_ability = model_ability
        self.support_function_call = support_function_call
        self.support_vision = support_vision
        self.max_tokens = max_tokens
        self.context_length = context_length
        self.model_family = model_family


cache = {}
cache_lock = Lock()


class XinferenceHelper:
    @staticmethod
    def get_xinference_extra_parameter(server_url: str, model_uid: str, api_key: str) -> XinferenceModelExtraParameter:
        XinferenceHelper._clean_cache()
        with cache_lock:
            if model_uid not in cache:
                cache[model_uid] = {
                    "expires": time() + 300,
                    "value": XinferenceHelper._get_xinference_extra_parameter(server_url, model_uid, api_key),
                }
            return cache[model_uid]["value"]

    @staticmethod
    def _clean_cache() -> None:
        try:
            with cache_lock:
                expired_keys = [model_uid for model_uid, model in cache.items() if model["expires"] < time()]
                for model_uid in expired_keys:
                    del cache[model_uid]
        except RuntimeError as e:
            pass

    @staticmethod
    def _get_xinference_extra_parameter(server_url: str, model_uid: str, api_key: str) -> XinferenceModelExtraParameter:
        """
        get xinference model extra parameter like model_format and model_handle_type
        """

        if not model_uid or not model_uid.strip() or not server_url or not server_url.strip():
            raise RuntimeError("model_uid is empty")

        url = str(URL(server_url) / "v1" / "models" / model_uid)

        # this method is surrounded by a lock, and default requests may hang forever,
        # so we just set a Adapter with max_retries=3
        session = Session()
        session.mount("http://", HTTPAdapter(max_retries=3))
        session.mount("https://", HTTPAdapter(max_retries=3))
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

        try:
            response = session.get(url, headers=headers, timeout=10)
        except (MissingSchema, ConnectionError, Timeout) as e:
            raise RuntimeError(f"get xinference model extra parameter failed, url: {url}, error: {e}")
        if response.status_code != 200:
            raise RuntimeError(
                f"get xinference model extra parameter failed, status code: {response.status_code},"
                f" response: {response.text}"
            )

        response_json = response.json()

        model_format = response_json.get("model_format", "ggmlv3")
        model_ability = response_json.get("model_ability", [])
        model_family = response_json.get("model_family", None)

        if response_json.get("model_type") == "embedding":
            model_handle_type = "embedding"
        elif response_json.get("model_type") == "audio":
            model_handle_type = "audio"
            if model_family and model_family in {"ChatTTS", "CosyVoice", "FishAudio"}:
                model_ability.append("text-to-audio")
            else:
                model_ability.append("audio-to-text")
        elif model_format == "ggmlv3" and "chatglm" in response_json["model_name"]:
            model_handle_type = "chatglm"
        elif "generate" in model_ability:
            model_handle_type = "generate"
        elif "chat" in model_ability:
            model_handle_type = "chat"
        else:
            raise NotImplementedError("xinference model handle type is not supported")

        support_function_call = "tools" in model_ability
        support_vision = "vision" in model_ability
        max_tokens = response_json.get("max_tokens", 512)

        context_length = response_json.get("context_length", 2048)

        return XinferenceModelExtraParameter(
            model_format=model_format,
            model_handle_type=model_handle_type,
            model_ability=model_ability,
            support_function_call=support_function_call,
            support_vision=support_vision,
            max_tokens=max_tokens,
            context_length=context_length,
            model_family=model_family,
        )


def validate_model_uid(credentials: dict) -> bool:
    """
    Validate the model_uid within the credentials dictionary to ensure it does not
    contain forbidden characters ("/", "?", "#").

    param credentials: model credentials
    :return: True if the model_uid does not contain forbidden characters ("/", "?", "#"), else False.
    """
    forbidden_characters = ["/", "?", "#"]
    model_uid = credentials.get("model_uid", "")
    return not any(char in forbidden_characters for char in model_uid)

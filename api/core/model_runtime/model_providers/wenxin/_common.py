from datetime import datetime, timedelta
from threading import Lock

from requests import post

from core.model_runtime.model_providers.wenxin.wenxin_errors import (
    BadRequestError,
    InternalServerError,
    InvalidAPIKeyError,
    InvalidAuthenticationError,
    RateLimitReachedError,
)

baidu_access_tokens: dict[str, "BaiduAccessToken"] = {}
baidu_access_tokens_lock = Lock()


class BaiduAccessToken:
    api_key: str
    access_token: str
    expires: datetime

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.access_token = ""
        self.expires = datetime.now() + timedelta(days=3)

    @staticmethod
    def _get_access_token(api_key: str, secret_key: str) -> str:
        """
        request access token from Baidu
        """
        try:
            response = post(
                url=f"https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id={api_key}&client_secret={secret_key}",
                headers={"Content-Type": "application/json", "Accept": "application/json"},
            )
        except Exception as e:
            raise InvalidAuthenticationError(f"Failed to get access token from Baidu: {e}")

        resp = response.json()
        if "error" in resp:
            if resp["error"] == "invalid_client":
                raise InvalidAPIKeyError(f"Invalid API key or secret key: {resp['error_description']}")
            elif resp["error"] == "unknown_error":
                raise InternalServerError(f"Internal server error: {resp['error_description']}")
            elif resp["error"] == "invalid_request":
                raise BadRequestError(f"Bad request: {resp['error_description']}")
            elif resp["error"] == "rate_limit_exceeded":
                raise RateLimitReachedError(f"Rate limit reached: {resp['error_description']}")
            else:
                raise Exception(f"Unknown error: {resp['error_description']}")

        return resp["access_token"]

    @staticmethod
    def get_access_token(api_key: str, secret_key: str) -> "BaiduAccessToken":
        """
        LLM from Baidu requires access token to invoke the API.
        however, we have api_key and secret_key, and access token is valid for 30 days.
        so we can cache the access token for 3 days. (avoid memory leak)

        it may be more efficient to use a ticker to refresh access token, but it will cause
        more complexity, so we just refresh access tokens when get_access_token is called.
        """

        # loop up cache, remove expired access token
        baidu_access_tokens_lock.acquire()
        now = datetime.now()
        for key in list(baidu_access_tokens.keys()):
            token = baidu_access_tokens[key]
            if token.expires < now:
                baidu_access_tokens.pop(key)

        if api_key not in baidu_access_tokens:
            # if access token not in cache, request it
            token = BaiduAccessToken(api_key)
            baidu_access_tokens[api_key] = token
            try:
                # try to get access token
                token_str = BaiduAccessToken._get_access_token(api_key, secret_key)
            finally:
                # release it to enhance performance
                # btw, _get_access_token will raise exception if failed, release lock here to avoid deadlock
                baidu_access_tokens_lock.release()
            token.access_token = token_str
            token.expires = now + timedelta(days=3)
            return token
        else:
            # if access token in cache, return it
            token = baidu_access_tokens[api_key]
            baidu_access_tokens_lock.release()
            return token


class _CommonWenxin:
    api_bases = {
        "ernie-bot": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-4k-0205",
        "ernie-bot-4": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro",
        "ernie-bot-8k": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions",
        "ernie-bot-turbo": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/eb-instant",
        "ernie-3.5-8k": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions",
        "ernie-3.5-8k-0205": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-8k-0205",
        "ernie-3.5-8k-1222": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-8k-1222",
        "ernie-3.5-4k-0205": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-4k-0205",
        "ernie-3.5-128k": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-128k",
        "ernie-4.0-8k": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro",
        "ernie-4.0-8k-latest": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro",
        "ernie-speed-8k": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie_speed",
        "ernie-speed-128k": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-speed-128k",
        "ernie-speed-appbuilder": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ai_apaas",
        "ernie-lite-8k-0922": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/eb-instant",
        "ernie-lite-8k-0308": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-lite-8k",
        "ernie-character-8k": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-char-8k",
        "ernie-character-8k-0321": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-char-8k",
        "ernie-4.0-turbo-8k": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-4.0-turbo-8k",
        "ernie-4.0-turbo-8k-preview": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-4.0-turbo-8k-preview",
        "ernie-4.0-turbo-128k": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-4.0-turbo-128k",
        "yi_34b_chat": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/yi_34b_chat",
        "embedding-v1": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/embeddings/embedding-v1",
        "bge-large-en": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/embeddings/bge_large_en",
        "bge-large-zh": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/embeddings/bge_large_zh",
        "tao-8k": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/embeddings/tao_8k",
        "bce-reranker-base_v1": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/reranker/bce_reranker_base",
        "ernie-lite-pro-128k": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-lite-pro-128k",
    }

    function_calling_supports = [
        "ernie-bot",
        "ernie-bot-8k",
        "ernie-3.5-8k",
        "ernie-3.5-8k-0205",
        "ernie-3.5-8k-1222",
        "ernie-3.5-4k-0205",
        "ernie-3.5-128k",
        "ernie-4.0-8k",
        "ernie-4.0-turbo-8k",
        "ernie-4.0-turbo-8k-preview",
        "yi_34b_chat",
    ]

    api_key: str = ""
    secret_key: str = ""

    def __init__(self, api_key: str, secret_key: str):
        self.api_key = api_key
        self.secret_key = secret_key

    @staticmethod
    def _to_credential_kwargs(credentials: dict) -> dict:
        credentials_kwargs = {"api_key": credentials["api_key"], "secret_key": credentials["secret_key"]}
        return credentials_kwargs

    def _handle_error(self, code: int, msg: str):
        error_map = {
            1: InternalServerError,
            2: InternalServerError,
            3: BadRequestError,
            4: RateLimitReachedError,
            6: InvalidAuthenticationError,
            13: InvalidAPIKeyError,
            14: InvalidAPIKeyError,
            15: InvalidAPIKeyError,
            17: RateLimitReachedError,
            18: RateLimitReachedError,
            19: RateLimitReachedError,
            100: InvalidAPIKeyError,
            111: InvalidAPIKeyError,
            200: InternalServerError,
            336000: InternalServerError,
            336001: BadRequestError,
            336002: BadRequestError,
            336003: BadRequestError,
            336004: InvalidAuthenticationError,
            336005: InvalidAPIKeyError,
            336006: BadRequestError,
            336007: BadRequestError,
            336008: BadRequestError,
            336100: InternalServerError,
            336101: BadRequestError,
            336102: BadRequestError,
            336103: BadRequestError,
            336104: BadRequestError,
            336105: BadRequestError,
            336200: InternalServerError,
            336303: BadRequestError,
            337006: BadRequestError,
        }

        if code in error_map:
            raise error_map[code](msg)
        else:
            raise InternalServerError(f"Unknown error: {msg}")

    def _get_access_token(self) -> str:
        token = BaiduAccessToken.get_access_token(self.api_key, self.secret_key)
        return token.access_token

from threading import Lock
from time import time
from typing import Optional

import httpx
from requests.adapters import HTTPAdapter
from requests.exceptions import ConnectionError, MissingSchema, Timeout
from requests.sessions import Session
from yarl import URL


class TeiModelExtraParameter:
    model_type: str
    max_input_length: int
    max_client_batch_size: int

    def __init__(self, model_type: str, max_input_length: int, max_client_batch_size: Optional[int] = None) -> None:
        self.model_type = model_type
        self.max_input_length = max_input_length
        self.max_client_batch_size = max_client_batch_size


cache = {}
cache_lock = Lock()


class TeiHelper:
    @staticmethod
    def get_tei_extra_parameter(
        server_url: str, model_name: str, headers: Optional[dict] = None
    ) -> TeiModelExtraParameter:
        TeiHelper._clean_cache()
        with cache_lock:
            if model_name not in cache:
                cache[model_name] = {
                    "expires": time() + 300,
                    "value": TeiHelper._get_tei_extra_parameter(server_url, headers),
                }
            return cache[model_name]["value"]

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
    def _get_tei_extra_parameter(server_url: str, headers: Optional[dict] = None) -> TeiModelExtraParameter:
        """
        get tei model extra parameter like model_type, max_input_length, max_batch_requests
        """

        url = str(URL(server_url) / "info")

        # this method is surrounded by a lock, and default requests may hang forever,
        # so we just set a Adapter with max_retries=3
        session = Session()
        session.mount("http://", HTTPAdapter(max_retries=3))
        session.mount("https://", HTTPAdapter(max_retries=3))

        try:
            response = session.get(url, headers=headers, timeout=10)
        except (MissingSchema, ConnectionError, Timeout) as e:
            raise RuntimeError(f"get tei model extra parameter failed, url: {url}, error: {e}")
        if response.status_code != 200:
            raise RuntimeError(
                f"get tei model extra parameter failed, status code: {response.status_code}, response: {response.text}"
            )

        response_json = response.json()

        model_type = response_json.get("model_type", {})
        if len(model_type.keys()) < 1:
            raise RuntimeError("model_type is empty")
        model_type = list(model_type.keys())[0]
        if model_type not in {"embedding", "reranker"}:
            raise RuntimeError(f"invalid model_type: {model_type}")

        max_input_length = response_json.get("max_input_length", 512)
        max_client_batch_size = response_json.get("max_client_batch_size", 1)

        return TeiModelExtraParameter(
            model_type=model_type, max_input_length=max_input_length, max_client_batch_size=max_client_batch_size
        )

    @staticmethod
    def invoke_tokenize(server_url: str, texts: list[str], headers: Optional[dict] = None) -> list[list[dict]]:
        """
        Invoke tokenize endpoint

        Example response:
        [
            [
                {
                    "id": 0,
                    "text": "<s>",
                    "special": true,
                    "start": null,
                    "stop": null
                },
                {
                    "id": 7704,
                    "text": "str",
                    "special": false,
                    "start": 0,
                    "stop": 3
                },
                < MORE TOKENS >
            ]
        ]

        :param server_url: server url
        :param texts: texts to tokenize
        """
        url = f"{server_url}/tokenize"
        json_data = {"inputs": texts}
        resp = httpx.post(url, json=json_data, headers=headers)

        resp.raise_for_status()
        return resp.json()

    @staticmethod
    def invoke_embeddings(server_url: str, texts: list[str], headers: Optional[dict] = None) -> dict:
        """
        Invoke embeddings endpoint

        Example response:
        {
            "object": "list",
            "data": [
                {
                    "object": "embedding",
                    "embedding": [...],
                    "index": 0
                }
            ],
            "model": "MODEL_NAME",
            "usage": {
                "prompt_tokens": 3,
                "total_tokens": 3
            }
        }

        :param server_url: server url
        :param texts: texts to embed
        """
        # Use OpenAI compatible API here, which has usage tracking
        url = f"{server_url}/v1/embeddings"
        json_data = {"input": texts}
        resp = httpx.post(url, json=json_data, headers=headers)
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    def invoke_rerank(server_url: str, query: str, docs: list[str], headers: Optional[dict] = None) -> list[dict]:
        """
        Invoke rerank endpoint

        Example response:
        [
            {
                "index": 0,
                "text": "Deep Learning is ...",
                "score": 0.9950755
            }
        ]

        :param server_url: server url
        :param texts: texts to rerank
        :param candidates: candidates to rerank
        """
        params = {"query": query, "texts": docs, "return_text": True}
        url = f"{server_url}/rerank"
        response = httpx.post(url, json=params, headers=headers)
        response.raise_for_status()
        return response.json()

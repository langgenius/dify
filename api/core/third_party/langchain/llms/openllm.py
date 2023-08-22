from __future__ import annotations

import logging
from typing import (
    Any,
    Dict,
    List,
    Optional,
)

import requests
from langchain.llms.utils import enforce_stop_tokens
from pydantic import Field

from langchain.callbacks.manager import (
    AsyncCallbackManagerForLLMRun,
    CallbackManagerForLLMRun,
)
from langchain.llms.base import LLM

logger = logging.getLogger(__name__)


class OpenLLM(LLM):
    """OpenLLM, supporting both in-process model
    instance and remote OpenLLM servers.

    If you have a OpenLLM server running, you can also use it remotely:
        .. code-block:: python

            from langchain.llms import OpenLLM
            llm = OpenLLM(server_url='http://localhost:3000')
            llm("What is the difference between a duck and a goose?")
    """

    server_url: Optional[str] = None
    """Optional server URL that currently runs a LLMServer with 'openllm start'."""
    llm_kwargs: Dict[str, Any] = Field(default_factory=dict)
    """Key word arguments to be passed to openllm.LLM"""

    @property
    def _llm_type(self) -> str:
        return "openllm"

    def _call(
        self,
        prompt: str,
        stop: Optional[List[str]] = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> str:
        params = {
            "prompt": prompt,
            "llm_config": self.llm_kwargs
        }

        headers = {"Content-Type": "application/json"}
        response = requests.post(
            f'{self.server_url}/v1/generate',
            headers=headers,
            json=params
        )

        if not response.ok:
            raise ValueError(f"OpenLLM HTTP {response.status_code} error: {response.text}")

        json_response = response.json()
        completion = json_response["responses"][0]

        if stop is not None:
            completion = enforce_stop_tokens(completion, stop)

        return completion

    async def _acall(
        self,
        prompt: str,
        stop: Optional[List[str]] = None,
        run_manager: Optional[AsyncCallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> str:
        raise NotImplementedError(
            "Async call is not supported for OpenLLM at the moment."
        )

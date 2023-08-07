from typing import Dict, Any

from langchain.llms import Tongyi


class EnhanceTongyi(Tongyi):
    @property
    def _default_params(self) -> Dict[str, Any]:
        """Get the default parameters for calling OpenAI API."""
        normal_params = {
            "top_p": self.top_p,
            "api_key": self.dashscope_api_key
        }

        return {**normal_params, **self.model_kwargs}

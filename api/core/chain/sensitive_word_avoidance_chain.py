from typing import List, Dict

from langchain.chains.base import Chain


class SensitiveWordAvoidanceChain(Chain):
    input_key: str = "input"  #: :meta private:
    output_key: str = "output"  #: :meta private:

    sensitive_words: List[str] = []
    canned_response: str = None

    @property
    def _chain_type(self) -> str:
        return "sensitive_word_avoidance_chain"

    @property
    def input_keys(self) -> List[str]:
        """Expect input key.

        :meta private:
        """
        return [self.input_key]

    @property
    def output_keys(self) -> List[str]:
        """Return output key.

        :meta private:
        """
        return [self.output_key]

    def _check_sensitive_word(self, text: str) -> str:
        for word in self.sensitive_words:
            if word in text:
                return self.canned_response
        return text

    def _call(self, inputs: Dict[str, str]) -> Dict[str, str]:
        text = inputs[self.input_key]
        output = self._check_sensitive_word(text)
        return {self.output_key: output}

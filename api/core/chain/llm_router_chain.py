"""Base classes for LLM-powered router chains."""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Type, cast, NamedTuple

from langchain.chains.base import Chain
from pydantic import root_validator

from langchain.chains import LLMChain
from langchain.prompts import BasePromptTemplate
from langchain.schema import BaseOutputParser, OutputParserException, BaseLanguageModel

from libs.json_in_md_parser import parse_and_check_json_markdown


class Route(NamedTuple):
    destination: Optional[str]
    next_inputs: Dict[str, Any]


class LLMRouterChain(Chain):
    """A router chain that uses an LLM chain to perform routing."""

    llm_chain: LLMChain
    """LLM chain used to perform routing"""

    @root_validator()
    def validate_prompt(cls, values: dict) -> dict:
        prompt = values["llm_chain"].prompt
        if prompt.output_parser is None:
            raise ValueError(
                "LLMRouterChain requires base llm_chain prompt to have an output"
                " parser that converts LLM text output to a dictionary with keys"
                " 'destination' and 'next_inputs'. Received a prompt with no output"
                " parser."
            )
        return values

    @property
    def input_keys(self) -> List[str]:
        """Will be whatever keys the LLM chain prompt expects.

        :meta private:
        """
        return self.llm_chain.input_keys

    def _validate_outputs(self, outputs: Dict[str, Any]) -> None:
        super()._validate_outputs(outputs)
        if not isinstance(outputs["next_inputs"], dict):
            raise ValueError

    def _call(
        self,
        inputs: Dict[str, Any]
    ) -> Dict[str, Any]:
        output = cast(
            Dict[str, Any],
            self.llm_chain.predict_and_parse(**inputs),
        )
        return output

    @classmethod
    def from_llm(
        cls, llm: BaseLanguageModel, prompt: BasePromptTemplate, **kwargs: Any
    ) -> LLMRouterChain:
        """Convenience constructor."""
        llm_chain = LLMChain(llm=llm, prompt=prompt)
        return cls(llm_chain=llm_chain, **kwargs)

    @property
    def output_keys(self) -> List[str]:
        return ["destination", "next_inputs"]

    def route(self, inputs: Dict[str, Any]) -> Route:
        result = self(inputs)
        return Route(result["destination"], result["next_inputs"])


class RouterOutputParser(BaseOutputParser[Dict[str, str]]):
    """Parser for output of router chain int he multi-prompt chain."""

    default_destination: str = "DEFAULT"
    next_inputs_type: Type = str
    next_inputs_inner_key: str = "input"

    def parse(self, text: str) -> Dict[str, Any]:
        try:
            expected_keys = ["destination", "next_inputs"]
            parsed = parse_and_check_json_markdown(text, expected_keys)
            if not isinstance(parsed["destination"], str):
                raise ValueError("Expected 'destination' to be a string.")
            if not isinstance(parsed["next_inputs"], self.next_inputs_type):
                raise ValueError(
                    f"Expected 'next_inputs' to be {self.next_inputs_type}."
                )
            parsed["next_inputs"] = {self.next_inputs_inner_key: parsed["next_inputs"]}
            if (
                parsed["destination"].strip().lower()
                == self.default_destination.lower()
            ):
                parsed["destination"] = None
            else:
                parsed["destination"] = parsed["destination"].strip()
            return parsed
        except Exception as e:
            raise OutputParserException(
                f"Parsing text\n{text}\n of llm router raised following error:\n{e}"
            )

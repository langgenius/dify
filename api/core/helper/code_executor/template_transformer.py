from abc import ABC, abstractmethod


class TemplateTransformer(ABC):
    @classmethod
    @abstractmethod
    def transform_caller(cls, code: str, inputs: dict) -> str:
        """
        Transform code to python runner
        :param code: code
        :param inputs: inputs
        :return:
        """
        pass
    
    @classmethod
    @abstractmethod
    def transform_response(cls, response: str) -> dict:
        """
        Transform response to dict
        :param response: response
        :return:
        """
        pass
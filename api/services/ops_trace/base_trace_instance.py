from abc import ABC, abstractmethod


class BaseTraceInstance(ABC):
    @abstractmethod
    def __init__(self):
        ...

    @abstractmethod
    def message_trace(self, **kwargs):
        return kwargs

    @abstractmethod
    def moderation_trace(self, **kwargs):
        return kwargs

    @abstractmethod
    def suggested_question_trace(self, **kwargs):
        return kwargs

    @abstractmethod
    def dataset_retrieval_trace(self, **kwargs):
        return kwargs

    @abstractmethod
    def tool_trace(self, **kwargs):
        return kwargs

    @abstractmethod
    def generate_name_trace(self, **kwargs):
        return kwargs

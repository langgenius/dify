from abc import ABC, abstractmethod


class BaseTraceInstance(ABC):
    """
    Base trace instance for ops trace services
    """

    @abstractmethod
    def __init__(self):
        """
        Abstract initializer for the trace instance.
        Distribute trace tasks by matching entities
        """
        ...

    @abstractmethod
    def trace(self, **kwargs):
        """
        Abstract method to trace activities.
        Subclasses must implement specific tracing logic for activities.
        """
        return kwargs

    @abstractmethod
    def message_trace(self, **kwargs):
        """
        Abstract method to trace messaging activities.
        Subclasses must implement specific tracing logic for messages.
        """
        return kwargs

    @abstractmethod
    def moderation_trace(self, **kwargs):
        """
        Abstract method to trace moderation activities.
        Subclasses must implement specific tracing logic for content moderation.
        """
        return kwargs

    @abstractmethod
    def suggested_question_trace(self, **kwargs):
        """
        Abstract method to trace suggested questions in a conversation or system.
        Subclasses must implement specific tracing logic for tracking suggested questions.
        """
        return kwargs

    @abstractmethod
    def dataset_retrieval_trace(self, **kwargs):
        """
        Abstract method to trace data retrieval activities.
        Subclasses must implement specific tracing logic for data retrieval operations.
        """
        return kwargs

    @abstractmethod
    def tool_trace(self, **kwargs):
        """
        Abstract method to trace the usage of tools within the system.
        Subclasses must implement specific tracing logic for tool interactions.
        """
        return kwargs

    @abstractmethod
    def generate_name_trace(self, **kwargs):
        """
        Abstract method to trace the generation of names or identifiers within the system.
        Subclasses must implement specific tracing logic for name generation activities.
        """
        return kwargs

    @abstractmethod
    def api_check_trace(self, **kwargs):
        """
        Abstract method to trace API check activities.
        Subclasses must implement specific tracing logic for API check operations.
        """
        return kwargs

    @abstractmethod
    def obfuscate_config(self, **kwargs):
        """
        Obfuscate configuration data.
        """
        return kwargs

    @abstractmethod
    def encrypt_config(self, **kwargs):
        """
        Encrypt configuration data.
        """
        return kwargs

    @abstractmethod
    def decryption_config(self, **kwargs):
        """
        Decrypt configuration data.
        """
        return kwargs

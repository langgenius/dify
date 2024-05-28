from time import time

from openai.resources.models import Models
from openai.types.model import Model


class MockModelClass:
    """
        mock class for openai.models.Models
    """
    def list(
        self,
        **kwargs,
    ) -> list[Model]:
        return [
            Model(
                id='ft:gpt-3.5-turbo-0613:personal::8GYJLPDQ',
                created=int(time()),
                object='model',
                owned_by='organization:org-123',
            )
        ]
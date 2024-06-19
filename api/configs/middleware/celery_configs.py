
from pydantic import BaseModel, Field, computed_field

from config import get_env


class CeleryConfigs(BaseModel):
    """
    Celery configs
    """

    CELERY_BROKER_URL: str = Field(
        description='Database',
        default='',
    )

    CELERY_BACKEND: str = Field(
        description='Database',
        default='database',
    )

    @computed_field
    @property
    def CELERY_RESULT_BACKEND(self) -> str:
        return 'db+{}'.format(get_env('SQLALCHEMY_DATABASE_URI') \
                                  if self.CELERY_BACKEND == 'database' else self.CELERY_BROKER_URL)

    @computed_field
    @property
    def BROKER_USE_SSL(self) -> bool:
        return self.CELERY_BROKER_URL.startswith('rediss://') if self.CELERY_BROKER_URL else False

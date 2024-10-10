from abc import ABC, abstractmethod

from flask import Flask
from pydantic import BaseModel


class BasicAssembly(ABC, BaseModel):
    @abstractmethod
    def prepare_app(self, app: Flask):
        raise NotImplementedError

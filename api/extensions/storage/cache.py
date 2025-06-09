from abc import ABC, abstractmethod
import uuid

class Cache(ABC):
    @abstractmethod
    def generate_id(self, *args, **kwargs):
        pass

    @abstractmethod
    def get(self, id, field):
        pass

    @abstractmethod
    def get_all(self, field_list) -> list:
        pass

    @abstractmethod
    def set(self, id, field, value):
        pass

    @abstractmethod
    def delete(self, id):
        pass


class MemoryCache(Cache):
    def __init__(self):
        self.cache = {}

    def generate_id(self, *args, **kwargs):
        return str(uuid.uuid4())

    def set(self, id, field, value):
        if id not in self.cache:
            self.cache[id] = {}

        self.cache[id][field] = value

    def get(self, id, field):
        if id not in self.cache:
            return None

        if field not in self.cache[id]:
            return None

        return self.cache[id][field]

    def get_all(self, field_list) -> list:
        return [
            {
                "id": id,
                **{
                    field: self.get(id=id, field=field)
                    for field in field_list
                }
            }
            for id in self.cache
        ]

    def delete(self, id):
        if id in self.cache:
            del self.cache[id]
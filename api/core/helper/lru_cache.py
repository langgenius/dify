from collections import OrderedDict
from typing import Any


class LRUCache:
    def __init__(self, capacity: int):
        self.cache: OrderedDict[Any, Any] = OrderedDict()
        self.capacity = capacity

    def get(self, key: Any) -> Any:
        if key not in self.cache:
            return None
        else:
            self.cache.move_to_end(key)  # move the key to the end of the OrderedDict
            return self.cache[key]

    def put(self, key: Any, value: Any) -> None:
        if key in self.cache:
            self.cache.move_to_end(key)
        self.cache[key] = value
        if len(self.cache) > self.capacity:
            self.cache.popitem(last=False)  # pop the first item

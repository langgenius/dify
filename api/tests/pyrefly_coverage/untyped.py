"""Completely untyped module — no annotations at all."""


def add(a, b):
    return a + b


def concat(items, sep):
    return sep.join(items)


class Config:
    def __init__(self, data):
        self.data = data
        self.cache = {}

    def get(self, key, default=None):
        if key in self.cache:
            return self.cache[key]
        val = self.data.get(key, default)
        self.cache[key] = val
        return val

    def keys(self):
        return list(self.data.keys())


def load_config(path):
    import json
    with open(path) as f:
        return Config(json.load(f))

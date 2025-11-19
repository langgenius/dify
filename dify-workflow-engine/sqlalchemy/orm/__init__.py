class Session:
    def __init__(self, *args, **kwargs):
        pass
    def close(self):
        pass
    def commit(self):
        pass
    def rollback(self):
        pass
    def add(self, obj):
        pass
    def query(self, *args, **kwargs):
        return self
    def filter(self, *args, **kwargs):
        return self
    def all(self):
        return []

def sessionmaker(*args, **kwargs):
    return Session

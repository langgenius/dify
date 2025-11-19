from contextlib import contextmanager

@contextmanager
def preserve_flask_contexts(flask_app=None, context_vars=None):
    yield

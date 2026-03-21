class _EventHook:
    def __init__(self):
        self._handlers = []

    def __iadd__(self, handler):
        self._handlers.append(handler)
        return self

    def __isub__(self, handler):
        try:
            self._handlers.remove(handler)
        except ValueError:
            pass
        return self

    def __call__(self, *args, **kwargs):
        for handler in list(self._handlers):
            handler(*args, **kwargs)


class Events:
    def __getattr__(self, name):
        hook = _EventHook()
        setattr(self, name, hook)
        return hook

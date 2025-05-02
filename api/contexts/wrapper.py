from contextvars import ContextVar
from typing import Generic, TypeVar

T = TypeVar("T")


class HiddenValue:
    pass


_default = HiddenValue()


class RecyclableContextVar(Generic[T]):
    """
    RecyclableContextVar is a wrapper around ContextVar
    It's safe to use in gunicorn with thread recycling, but features like `reset` are not available for now

    NOTE: you need to call `increment_thread_recycles` before requests
    """

    _thread_recycles: ContextVar[int] = ContextVar("thread_recycles")

    @classmethod
    def increment_thread_recycles(cls):
        try:
            recycles = cls._thread_recycles.get()
            cls._thread_recycles.set(recycles + 1)
        except LookupError:
            cls._thread_recycles.set(0)

    def __init__(self, context_var: ContextVar[T]):
        self._context_var = context_var
        self._updates = ContextVar[int](context_var.name + "_updates", default=0)

    def get(self, default: T | HiddenValue = _default) -> T:
        thread_recycles = self._thread_recycles.get(0)
        self_updates = self._updates.get()
        if thread_recycles > self_updates:
            self._updates.set(thread_recycles)

        # check if thread is recycled and should be updated
        if thread_recycles < self_updates:
            return self._context_var.get()
        else:
            # thread_recycles >= self_updates, means current context is invalid
            if isinstance(default, HiddenValue) or default is _default:
                raise LookupError
            else:
                return default

    def set(self, value: T):
        # it leads to a situation that self.updates is less than cls.thread_recycles if `set` was never called before
        # increase it manually
        thread_recycles = self._thread_recycles.get(0)
        self_updates = self._updates.get()
        if thread_recycles > self_updates:
            self._updates.set(thread_recycles)

        if self._updates.get() == self._thread_recycles.get(0):
            # after increment,
            self._updates.set(self._updates.get() + 1)

        # set the context
        self._context_var.set(value)

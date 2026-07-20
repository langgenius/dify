import contextlib
import logging
import time
import uuid
from collections.abc import Generator, Mapping
from datetime import timedelta
from typing import Any, Union

from core.errors.error import AppInvokeQuotaExceededError
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)


class RateLimit:
    _MAX_ACTIVE_REQUESTS_KEY = "dify:rate_limit:{}:max_active_requests"
    _ACTIVE_REQUESTS_KEY = "dify:rate_limit:{}:active_requests"
    _UNLIMITED_REQUEST_ID = "unlimited_request_id"
    _REQUEST_MAX_ALIVE_TIME = 10 * 60  # 10 minutes
    _ACTIVE_REQUESTS_COUNT_FLUSH_INTERVAL = 5 * 60  # recalculate request_count from request_detail every 5 minutes
    _instance_dict: dict[str, "RateLimit"] = {}
    max_active_requests: int

    # Atomically enforce the active-request cap and admit a request in a single
    # round trip. The previous implementation ran HLEN (check) and HSET (act) as
    # two independent Redis calls, so N concurrent callers could all observe a
    # count below the cap and all proceed to register, pushing the active count
    # to ``max_active_requests - 1 + N``. Doing the check-and-set inside a Lua
    # script makes Redis evaluate it single-threaded and eliminates the race.
    #
    # KEYS[1] = active requests hash key
    # ARGV[1] = request id (hash field)
    # ARGV[2] = timestamp to store as the field value
    # ARGV[3] = max active requests cap
    # Returns the stored value on admit, or nil on rejection.
    _ADMIT_SCRIPT = """
        if redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[3]) then
            return nil
        end
        return redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
    """

    def __new__(cls, client_id: str, max_active_requests: int):
        if client_id not in cls._instance_dict:
            instance = super().__new__(cls)
            cls._instance_dict[client_id] = instance
        return cls._instance_dict[client_id]

    def __init__(self, client_id: str, max_active_requests: int):
        flush_cache = hasattr(self, "max_active_requests") and self.max_active_requests != max_active_requests
        self.max_active_requests = max_active_requests
        # Only flush here if this instance has already been fully initialized,
        # i.e. the Redis key attributes exist. Otherwise, rely on the flush at
        # the end of initialization below.
        if flush_cache and hasattr(self, "active_requests_key") and hasattr(self, "max_active_requests_key"):
            self.flush_cache(use_local_value=True)
        # must be called after max_active_requests is set
        if self.disabled():
            return
        if hasattr(self, "initialized"):
            return
        self.initialized = True
        self.client_id = client_id
        self.active_requests_key = self._ACTIVE_REQUESTS_KEY.format(client_id)
        self.max_active_requests_key = self._MAX_ACTIVE_REQUESTS_KEY.format(client_id)
        self.last_recalculate_time = float("-inf")
        self.flush_cache(use_local_value=True)
        self._admit_script = redis_client.register_script(self._ADMIT_SCRIPT)

    def flush_cache(self, use_local_value=False):
        self.last_recalculate_time = time.time()
        # flush max active requests
        if use_local_value or not redis_client.exists(self.max_active_requests_key):
            redis_client.setex(self.max_active_requests_key, timedelta(days=1), self.max_active_requests)
        else:
            self.max_active_requests = int(redis_client.get(self.max_active_requests_key).decode("utf-8"))
            redis_client.expire(self.max_active_requests_key, timedelta(days=1))
        if self.disabled():
            return
        # flush max active requests (in-transit request list)
        if not redis_client.exists(self.active_requests_key):
            return
        request_details = redis_client.hgetall(self.active_requests_key)
        redis_client.expire(self.active_requests_key, timedelta(days=1))
        timeout_requests = [
            k
            for k, v in request_details.items()
            if time.time() - float(v.decode("utf-8")) > RateLimit._REQUEST_MAX_ALIVE_TIME
        ]
        if timeout_requests:
            redis_client.hdel(self.active_requests_key, *timeout_requests)

    def enter(self, request_id: str | None = None) -> str:
        if self.disabled():
            return RateLimit._UNLIMITED_REQUEST_ID
        if time.time() - self.last_recalculate_time > RateLimit._ACTIVE_REQUESTS_COUNT_FLUSH_INTERVAL:
            self.flush_cache()
        if not request_id:
            request_id = RateLimit.gen_request_key()

        # Admit atomically: the Lua script checks HLEN against the cap and only
        # runs HSET when there is still headroom, all in one Redis round trip.
        # It returns nil (None in Python) when the cap has been reached.
        admitted = self._admit_script(
            keys=[self.active_requests_key],
            args=[request_id, str(time.time()), self.max_active_requests],
        )
        if admitted is None:
            raise AppInvokeQuotaExceededError(
                f"Too many requests. Please try again later. The current maximum concurrent requests allowed "
                f"for {self.client_id} is {self.max_active_requests}."
            )
        return request_id

    def exit(self, request_id: str):
        if request_id == RateLimit._UNLIMITED_REQUEST_ID:
            return
        redis_client.hdel(self.active_requests_key, request_id)

    def disabled(self):
        return self.max_active_requests <= 0

    @staticmethod
    def gen_request_key() -> str:
        return str(uuid.uuid4())

    def generate(self, generator: Union[Generator[str, None, None], Mapping[str, Any]], request_id: str):
        if isinstance(generator, Mapping):
            return generator
        else:
            return RateLimitGenerator(
                rate_limit=self,
                generator=generator,
                request_id=request_id,
            )


@contextlib.contextmanager
def rate_limit_context(rate_limit: RateLimit, request_id: str | None):
    request_id = rate_limit.enter(request_id)
    yield
    if request_id is not None:
        rate_limit.exit(request_id)


class RateLimitGenerator:
    def __init__(self, rate_limit: RateLimit, generator: Generator[str, None, None], request_id: str):
        self.rate_limit = rate_limit
        self.generator = generator
        self.request_id = request_id
        self.closed = False

    def __iter__(self):
        return self

    def __next__(self):
        if self.closed:
            raise StopIteration
        try:
            return next(self.generator)
        except Exception:
            self.close()
            raise

    def close(self):
        if not self.closed:
            self.closed = True
            self.rate_limit.exit(self.request_id)
            if self.generator is not None and hasattr(self.generator, "close"):
                self.generator.close()

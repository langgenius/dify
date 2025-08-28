import logging

from flask import Request, Response

logger = logging.getLogger(__name__)


class TriggerService:
    __MAX_REQUEST_LOG_COUNT__ = 10

    @classmethod
    def process_webhook(cls, webhook_id: str, request: Request) -> Response:
        """Extract and process data from incoming webhook request."""
        # TODO redis slidingwindow log, save the recent request log in redis, rollover the log when the window is full

        # TODO find the trigger subscription

        # TODO fetch the trigger controller

        # TODO dispatch by the trigger controller

        # TODO using the dispatch result(events) to invoke the trigger events
        raise NotImplementedError("Not implemented")
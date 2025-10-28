class BroadcastChannelError(Exception):
    """`ChannelError` is the base class for all exceptions related
    to `BroadcastChannel`."""

    pass


class SubscriptionClosedError(BroadcastChannelError):
    """SubscriptionClosedError means that the subscription has been closed and
    methods for consuming messages should not be called."""

    pass

from .segment_group import SegmentGroup
from .segments import Segment
from .variables import SecretVariable


def is_sensitive(segment: Segment) -> bool:
    """Return True if the segment is a secret or recursively contains one.

    Used by the runtime serializer to decide whether to emit the masked
    ``.log`` representation instead of the plaintext ``.value``.

    Returns:
        True if the segment is a SecretVariable or a SegmentGroup that
        contains at least one SecretVariable (at any depth), False otherwise.
    """
    if isinstance(segment, SecretVariable):
        return True
    if isinstance(segment, SegmentGroup):
        return any(is_sensitive(child) for child in segment.value)
    return False

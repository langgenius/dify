import uuid


def is_valid_uuid(uuid_str: str | None) -> bool:
    if uuid_str is None:
        return False
    try:

        uuid.UUID(uuid_str)
        return True
    except Exception:
        return False

from datetime import datetime, timezone

def naive_utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)

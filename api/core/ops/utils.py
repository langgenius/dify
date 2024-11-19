from contextlib import contextmanager
from datetime import datetime
from typing import Optional, Union

from extensions.ext_database import db
from models.model import Message


def filter_none_values(data: dict):
    new_data = {}
    for key, value in data.items():
        if value is None:
            continue
        if isinstance(value, datetime):
            new_data[key] = value.isoformat()
        else:
            new_data[key] = value
    return new_data


def get_message_data(message_id):
    return db.session.query(Message).filter(Message.id == message_id).first()


@contextmanager
def measure_time():
    timing_info = {"start": datetime.now(), "end": None}
    try:
        yield timing_info
    finally:
        timing_info["end"] = datetime.now()


def replace_text_with_content(data):
    if isinstance(data, dict):
        new_data = {}
        for key, value in data.items():
            if key == "text":
                new_data["content"] = value
            else:
                new_data[key] = replace_text_with_content(value)
        return new_data
    elif isinstance(data, list):
        return [replace_text_with_content(item) for item in data]
    else:
        return data


def generate_dotted_order(
    run_id: str, start_time: Union[str, datetime], parent_dotted_order: Optional[str] = None
) -> str:
    """
    generate dotted_order for langsmith
    """
    start_time = datetime.fromisoformat(start_time) if isinstance(start_time, str) else start_time
    timestamp = start_time.strftime("%Y%m%dT%H%M%S%f")[:-3] + "Z"
    current_segment = f"{timestamp}{run_id}"

    if parent_dotted_order is None:
        return current_segment

    return f"{parent_dotted_order}.{current_segment}"

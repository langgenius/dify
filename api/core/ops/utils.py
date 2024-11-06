from contextlib import contextmanager
from datetime import datetime

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


def convert_datetime_to_str(data):
    if isinstance(data, dict):
        for key, value in data.items():
            if isinstance(value, datetime):
                data[key] = value.isoformat()
            elif isinstance(value, dict):
                data[key] = convert_datetime_to_str(value)
            elif isinstance(value, list):
                data[key] = [convert_datetime_to_str(item) if isinstance(item, dict | list) else item for item in value]
    elif isinstance(data, list):
        data = [convert_datetime_to_str(item) if isinstance(item, dict | list) else item for item in data]
    return data

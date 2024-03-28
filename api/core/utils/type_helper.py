import os


def get_bool(value: str) -> bool:
    if not value:
        return False
    else:
        match value:
            case 'true' | 'True':
                return True
            case 'false' | 'False':
                return False
            case '1':
                return True
            case '0':
                return False

        match value.strip().lower():
            case 'true':
                return True
            case 'false':
                return False
            case _:
                raise ValueError(f'Value {value} should be true or false')


def get_bool_by_key(inputs: dict, key: str) -> bool:
    if not inputs or not key:
        return False
    else:
        return get_bool(inputs.get(key))


def get_bool_from_sys_env(key: str) -> bool:
    return get_bool(os.getenv(key, 'false'))

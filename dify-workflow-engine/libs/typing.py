def is_str(v):
    return isinstance(v, str)

def is_str_dict(v):
    return isinstance(v, dict) and all(isinstance(k, str) for k in v.keys())

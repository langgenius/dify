import functools

from flask import Response


def add_security_headers(f):
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        response = f(*args, **kwargs)
        if isinstance(response, Response):
            response.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["Referrer-Policy"] = "no-referrer"
        return response

    return decorated_function

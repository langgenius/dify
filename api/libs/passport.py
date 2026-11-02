import jwt
from werkzeug.exceptions import Unauthorized

from configs import dify_config


class PassportService:
    def __init__(self):
        self.sk = dify_config.SECRET_KEY

    def issue(self, payload):
        return jwt.encode(payload, self.sk, algorithm="HS256")

    def verify(self, token):
        try:
            return jwt.decode(token, self.sk, algorithms=["HS256"])
        except jwt.ExpiredSignatureError as caught_error:
            raise Unauthorized("Token has expired.") from caught_error
        except jwt.InvalidSignatureError as caught_error:
            raise Unauthorized("Invalid token signature.") from caught_error
        except jwt.DecodeError as caught_error:
            raise Unauthorized("Invalid token.") from caught_error
        except jwt.PyJWTError as caught_error:  # Catch-all for other JWT errors
            raise Unauthorized("Invalid token.") from caught_error

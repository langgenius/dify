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
        except jwt.ExpiredSignatureError:
            raise Unauthorized("Token has expired.")
        except jwt.InvalidSignatureError:
            raise Unauthorized("Invalid token signature.")
        except jwt.DecodeError:
            raise Unauthorized("Invalid token.")
        except jwt.PyJWTError:  # Catch-all for other JWT errors
            raise Unauthorized("Invalid token.")

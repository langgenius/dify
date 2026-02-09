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
            raise Unauthorized("令牌已过期。")
        except jwt.InvalidSignatureError:
            raise Unauthorized("无效的令牌签名。")
        except jwt.DecodeError:
            raise Unauthorized("无效的令牌。")
        except jwt.PyJWTError:  # Catch-all for other JWT errors
            raise Unauthorized("无效的令牌。")

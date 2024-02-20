import jwt
from flask import current_app
from werkzeug.exceptions import Unauthorized


class PassportService:
    def __init__(self):
        self.sk = current_app.config.get('SECRET_KEY')
    
    def issue(self, payload):
        return jwt.encode(payload, self.sk, algorithm='HS256')
    
    def verify(self, token):
        try:
            return jwt.decode(token, self.sk, algorithms=['HS256'])
        except jwt.exceptions.InvalidSignatureError:
            raise Unauthorized('Invalid token signature.')
        except jwt.exceptions.DecodeError:
            raise Unauthorized('Invalid token.')
        except jwt.exceptions.ExpiredSignatureError:
            raise Unauthorized('Token has expired.')

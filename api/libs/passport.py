# -*- coding:utf-8 -*-
import jwt

class PassportService:
    def __init__(self, sk, payload):
        self.sk = sk
        self.payload = payload
    
    def get_token(self):
        return jwt.encode(self.payload, self.sk, algorithm='HS256')
    
    def verify_token(self, token):
        return jwt.decode(token, self.sk, algorithms=['HS256'])

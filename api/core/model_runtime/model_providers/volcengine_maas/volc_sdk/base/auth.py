# coding : utf-8
import datetime

import pytz

from .util import Util


class MetaData:
    def __init__(self):
        self.algorithm = ''
        self.credential_scope = ''
        self.signed_headers = ''
        self.date = ''
        self.region = ''
        self.service = ''

    def set_date(self, date):
        self.date = date

    def set_service(self, service):
        self.service = service

    def set_region(self, region):
        self.region = region

    def set_algorithm(self, algorithm):
        self.algorithm = algorithm

    def set_credential_scope(self, credential_scope):
        self.credential_scope = credential_scope

    def set_signed_headers(self, signed_headers):
        self.signed_headers = signed_headers


class SignResult:
    def __init__(self):
        self.xdate = ''
        self.xCredential = ''
        self.xAlgorithm = ''
        self.xSignedHeaders = ''
        self.xSignedQueries = ''
        self.xSignature = ''
        self.xContextSha256 = ''
        self.xSecurityToken = ''

        self.authorization = ''

    def __str__(self):
        return '\n'.join(['{}:{}'.format(*item) for item in self.__dict__.items()])


class Credentials:
    def __init__(self, ak, sk, service, region, session_token=''):
        self.ak = ak
        self.sk = sk
        self.service = service
        self.region = region
        self.session_token = session_token

    def set_ak(self, ak):
        self.ak = ak

    def set_sk(self, sk):
        self.sk = sk

    def set_session_token(self, session_token):
        self.session_token = session_token


class Signer:
    @staticmethod
    def sign(request, credentials):
        if request.path == '':
            request.path = '/'
        if request.method != 'GET' and not ('Content-Type' in request.headers):
            request.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8'

        format_date = Signer.get_current_format_date()
        request.headers['X-Date'] = format_date
        if credentials.session_token != '':
            request.headers['X-Security-Token'] = credentials.session_token

        md = MetaData()
        md.set_algorithm('HMAC-SHA256')
        md.set_service(credentials.service)
        md.set_region(credentials.region)
        md.set_date(format_date[:8])

        hashed_canon_req = Signer.hashed_canonical_request_v4(request, md)
        md.set_credential_scope('/'.join([md.date, md.region, md.service, 'request']))

        signing_str = '\n'.join([md.algorithm, format_date, md.credential_scope, hashed_canon_req])
        signing_key = Signer.get_signing_secret_key_v4(credentials.sk, md.date, md.region, md.service)
        sign = Util.to_hex(Util.hmac_sha256(signing_key, signing_str))
        request.headers['Authorization'] = Signer.build_auth_header_v4(sign, md, credentials)
        return

    @staticmethod
    def hashed_canonical_request_v4(request, meta):
        body_hash = Util.sha256(request.body)
        request.headers['X-Content-Sha256'] = body_hash

        signed_headers = dict()
        for key in request.headers:
            if key in ['Content-Type', 'Content-Md5', 'Host'] or key.startswith('X-'):
                signed_headers[key.lower()] = request.headers[key]

        if 'host' in signed_headers:
            v = signed_headers['host']
            if v.find(':') != -1:
                split = v.split(':')
                port = split[1]
                if str(port) == '80' or str(port) == '443':
                    signed_headers['host'] = split[0]

        signed_str = ''
        for key in sorted(signed_headers.keys()):
            signed_str += key + ':' + signed_headers[key] + '\n'

        meta.set_signed_headers(';'.join(sorted(signed_headers.keys())))

        canonical_request = '\n'.join(
            [request.method, Util.norm_uri(request.path), Util.norm_query(request.query), signed_str,
             meta.signed_headers, body_hash])

        return Util.sha256(canonical_request)

    @staticmethod
    def get_signing_secret_key_v4(sk, date, region, service):
        date = Util.hmac_sha256(bytes(sk, encoding='utf-8'), date)
        region = Util.hmac_sha256(date, region)
        service = Util.hmac_sha256(region, service)
        return Util.hmac_sha256(service, 'request')

    @staticmethod
    def build_auth_header_v4(signature, meta, credentials):
        credential = credentials.ak + '/' + meta.credential_scope
        return meta.algorithm + ' Credential=' + credential + ', SignedHeaders=' + meta.signed_headers + ', Signature=' + signature

    @staticmethod
    def get_current_format_date():
        return datetime.datetime.now(tz=pytz.timezone('UTC')).strftime("%Y%m%dT%H%M%SZ")

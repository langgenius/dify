import json
from collections import OrderedDict
from urllib.parse import urlencode

import requests

from .auth import Signer

VERSION = 'v1.0.137'


class Service:
    def __init__(self, service_info, api_info):
        self.service_info = service_info
        self.api_info = api_info
        self.session = requests.session()

    def set_ak(self, ak):
        self.service_info.credentials.set_ak(ak)

    def set_sk(self, sk):
        self.service_info.credentials.set_sk(sk)

    def set_session_token(self, session_token):
        self.service_info.credentials.set_session_token(session_token)

    def set_host(self, host):
        self.service_info.host = host

    def set_scheme(self, scheme):
        self.service_info.scheme = scheme

    def get(self, api, params, doseq=0):
        if not (api in self.api_info):
            raise Exception("no such api")
        api_info = self.api_info[api]

        r = self.prepare_request(api_info, params, doseq)

        Signer.sign(r, self.service_info.credentials)

        url = r.build(doseq)
        resp = self.session.get(url, headers=r.headers,
                                timeout=(self.service_info.connection_timeout, self.service_info.socket_timeout))
        if resp.status_code == 200:
            return resp.text
        else:
            raise Exception(resp.text)

    def post(self, api, params, form):
        if not (api in self.api_info):
            raise Exception("no such api")
        api_info = self.api_info[api]
        r = self.prepare_request(api_info, params)
        r.headers['Content-Type'] = 'application/x-www-form-urlencoded'
        r.form = self.merge(api_info.form, form)
        r.body = urlencode(r.form, True)
        Signer.sign(r, self.service_info.credentials)

        url = r.build()

        resp = self.session.post(url, headers=r.headers, data=r.form,
                                 timeout=(self.service_info.connection_timeout, self.service_info.socket_timeout))
        if resp.status_code == 200:
            return resp.text
        else:
            raise Exception(resp.text)

    def json(self, api, params, body):
        if not (api in self.api_info):
            raise Exception("no such api")
        api_info = self.api_info[api]
        r = self.prepare_request(api_info, params)
        r.headers['Content-Type'] = 'application/json'
        r.body = body

        Signer.sign(r, self.service_info.credentials)

        url = r.build()
        resp = self.session.post(url, headers=r.headers, data=r.body,
                                 timeout=(self.service_info.connection_timeout, self.service_info.socket_timeout))
        if resp.status_code == 200:
            return json.dumps(resp.json())
        else:
            raise Exception(resp.text.encode("utf-8"))

    def put(self, url, file_path, headers):
        with open(file_path, 'rb') as f:
            resp = self.session.put(url, headers=headers, data=f)
            if resp.status_code == 200:
                return True, resp.text.encode("utf-8")
            else:
                return False, resp.text.encode("utf-8")

    def put_data(self, url, data, headers):
        resp = self.session.put(url, headers=headers, data=data)
        if resp.status_code == 200:
            return True, resp.text.encode("utf-8")
        else:
            return False, resp.text.encode("utf-8")

    def prepare_request(self, api_info, params, doseq=0):
        for key in params:
            if type(params[key]) == int or type(params[key]) == float or type(params[key]) == bool:
                params[key] = str(params[key])
            elif type(params[key]) == list:
                if not doseq:
                    params[key] = ','.join(params[key])

        connection_timeout = self.service_info.connection_timeout
        socket_timeout = self.service_info.socket_timeout

        r = Request()
        r.set_schema(self.service_info.scheme)
        r.set_method(api_info.method)
        r.set_connection_timeout(connection_timeout)
        r.set_socket_timeout(socket_timeout)

        headers = self.merge(api_info.header, self.service_info.header)
        headers['Host'] = self.service_info.host
        headers['User-Agent'] = 'volc-sdk-python/' + VERSION
        r.set_headers(headers)

        query = self.merge(api_info.query, params)
        r.set_query(query)

        r.set_host(self.service_info.host)
        r.set_path(api_info.path)

        return r

    @staticmethod
    def merge(param1, param2):
        od = OrderedDict()
        for key in param1:
            od[key] = param1[key]

        for key in param2:
            od[key] = param2[key]

        return od


class Request:
    def __init__(self):
        self.schema = ''
        self.method = ''
        self.host = ''
        self.path = ''
        self.headers = OrderedDict()
        self.query = OrderedDict()
        self.body = ''
        self.form = {}
        self.connection_timeout = 0
        self.socket_timeout = 0

    def set_schema(self, schema):
        self.schema = schema

    def set_method(self, method):
        self.method = method

    def set_host(self, host):
        self.host = host

    def set_path(self, path):
        self.path = path

    def set_headers(self, headers):
        self.headers = headers

    def set_query(self, query):
        self.query = query

    def set_body(self, body):
        self.body = body

    def set_connection_timeout(self, connection_timeout):
        self.connection_timeout = connection_timeout

    def set_socket_timeout(self, socket_timeout):
        self.socket_timeout = socket_timeout

    def build(self, doseq=0):
        return self.schema + '://' + self.host + self.path + '?' + urlencode(self.query, doseq)


class ServiceInfo:
    def __init__(self, host, header, credentials, connection_timeout, socket_timeout, scheme='http'):
        self.host = host
        self.header = header
        self.credentials = credentials
        self.connection_timeout = connection_timeout
        self.socket_timeout = socket_timeout
        self.scheme = scheme


class ApiInfo:
    def __init__(self, method, path, query, form, header):
        self.method = method
        self.path = path
        self.query = query
        self.form = form
        self.header = header

    def __str__(self):
        return 'method: ' + self.method + ', path: ' + self.path

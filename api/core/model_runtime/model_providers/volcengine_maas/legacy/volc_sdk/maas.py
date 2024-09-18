import copy
import json
from collections.abc import Iterator

from .base.auth import Credentials, Signer
from .base.service import ApiInfo, Service, ServiceInfo
from .common import SSEDecoder, dict_to_object, gen_req_id, json_to_object


class MaasService(Service):
    def __init__(self, host, region, connection_timeout=60, socket_timeout=60):
        service_info = self.get_service_info(host, region, connection_timeout, socket_timeout)
        self._apikey = None
        api_info = self.get_api_info()
        super().__init__(service_info, api_info)

    def set_apikey(self, apikey):
        self._apikey = apikey

    @staticmethod
    def get_service_info(host, region, connection_timeout, socket_timeout):
        service_info = ServiceInfo(
            host,
            {"Accept": "application/json"},
            Credentials("", "", "ml_maas", region),
            connection_timeout,
            socket_timeout,
            "https",
        )
        return service_info

    @staticmethod
    def get_api_info():
        api_info = {
            "chat": ApiInfo("POST", "/api/v2/endpoint/{endpoint_id}/chat", {}, {}, {}),
            "embeddings": ApiInfo("POST", "/api/v2/endpoint/{endpoint_id}/embeddings", {}, {}, {}),
        }
        return api_info

    def chat(self, endpoint_id, req):
        req["stream"] = False
        return self._request(endpoint_id, "chat", req)

    def stream_chat(self, endpoint_id, req):
        req_id = gen_req_id()
        self._validate("chat", req_id)
        apikey = self._apikey

        try:
            req["stream"] = True
            res = self._call(endpoint_id, "chat", req_id, {}, json.dumps(req).encode("utf-8"), apikey, stream=True)

            decoder = SSEDecoder(res)

            def iter_fn():
                for data in decoder.next():
                    if data == b"[DONE]":
                        return

                    try:
                        res = json_to_object(str(data, encoding="utf-8"), req_id=req_id)
                    except Exception:
                        raise

                    if res.error is not None and res.error.code_n != 0:
                        raise MaasError(
                            res.error.code_n,
                            res.error.code,
                            res.error.message,
                            req_id,
                        )
                    yield res

            return iter_fn()
        except MaasError:
            raise
        except Exception as e:
            raise new_client_sdk_request_error(str(e))

    def embeddings(self, endpoint_id, req):
        return self._request(endpoint_id, "embeddings", req)

    def _request(self, endpoint_id, api, req, params={}):
        req_id = gen_req_id()

        self._validate(api, req_id)

        apikey = self._apikey

        try:
            res = self._call(endpoint_id, api, req_id, params, json.dumps(req).encode("utf-8"), apikey)
            resp = dict_to_object(res.json())
            if resp and isinstance(resp, dict):
                resp["req_id"] = req_id
            return resp

        except MaasError as e:
            raise e
        except Exception as e:
            raise new_client_sdk_request_error(str(e), req_id)

    def _validate(self, api, req_id):
        credentials_exist = (
            self.service_info.credentials is not None
            and self.service_info.credentials.sk is not None
            and self.service_info.credentials.ak is not None
        )

        if not self._apikey and not credentials_exist:
            raise new_client_sdk_request_error("no valid credential", req_id)

        if api not in self.api_info:
            raise new_client_sdk_request_error("no such api", req_id)

    def _call(self, endpoint_id, api, req_id, params, body, apikey=None, stream=False):
        api_info = copy.deepcopy(self.api_info[api])
        api_info.path = api_info.path.format(endpoint_id=endpoint_id)

        r = self.prepare_request(api_info, params)
        r.headers["x-tt-logid"] = req_id
        r.headers["Content-Type"] = "application/json"
        r.body = body

        if apikey is None:
            Signer.sign(r, self.service_info.credentials)
        elif apikey is not None:
            r.headers["Authorization"] = "Bearer " + apikey

        url = r.build()
        res = self.session.post(
            url,
            headers=r.headers,
            data=r.body,
            timeout=(
                self.service_info.connection_timeout,
                self.service_info.socket_timeout,
            ),
            stream=stream,
        )

        if res.status_code != 200:
            raw = res.text.encode()
            res.close()
            try:
                resp = json_to_object(str(raw, encoding="utf-8"), req_id=req_id)
            except Exception:
                raise new_client_sdk_request_error(raw, req_id)

            if resp.error:
                raise MaasError(resp.error.code_n, resp.error.code, resp.error.message, req_id)
            else:
                raise new_client_sdk_request_error(resp, req_id)

        return res


class MaasError(Exception):
    def __init__(self, code_n, code, message, req_id):
        self.code_n = code_n
        self.code = code
        self.message = message
        self.req_id = req_id

    def __str__(self):
        return (
            "Detailed exception information is listed below.\n"
            + "req_id: {}\n"
            + "code_n: {}\n"
            + "code: {}\n"
            + "message: {}"
        ).format(self.req_id, self.code_n, self.code, self.message)


def new_client_sdk_request_error(raw, req_id=""):
    return MaasError(1709701, "ClientSDKRequestError", "MaaS SDK request error: {}".format(raw), req_id)


class BinaryResponseContent:
    def __init__(self, response, request_id) -> None:
        self.response = response
        self.request_id = request_id

    def stream_to_file(self, file: str) -> None:
        is_first = True
        error_bytes = b""
        with open(file, mode="wb") as f:
            for data in self.response:
                if len(error_bytes) > 0 or (is_first and '"error":' in str(data)):
                    error_bytes += data
                else:
                    f.write(data)

        if len(error_bytes) > 0:
            resp = json_to_object(str(error_bytes, encoding="utf-8"), req_id=self.request_id)
            raise MaasError(resp.error.code_n, resp.error.code, resp.error.message, self.request_id)

    def iter_bytes(self) -> Iterator[bytes]:
        yield from self.response

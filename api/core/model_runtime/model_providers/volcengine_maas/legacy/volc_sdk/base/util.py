import hashlib
import hmac
import operator
from functools import reduce
from urllib.parse import quote


class Util:
    @staticmethod
    def norm_uri(path):
        return quote(path).replace("%2F", "/").replace("+", "%20")

    @staticmethod
    def norm_query(params):
        query = ""
        for key in sorted(params.keys()):
            if type(params[key]) == list:
                for k in params[key]:
                    query = query + quote(key, safe="-_.~") + "=" + quote(k, safe="-_.~") + "&"
            else:
                query = query + quote(key, safe="-_.~") + "=" + quote(params[key], safe="-_.~") + "&"
        query = query[:-1]
        return query.replace("+", "%20")

    @staticmethod
    def hmac_sha256(key, content):
        return hmac.new(key, bytes(content, encoding="utf-8"), hashlib.sha256).digest()

    @staticmethod
    def sha256(content):
        if isinstance(content, str) is True:
            return hashlib.sha256(content.encode("utf-8")).hexdigest()
        else:
            return hashlib.sha256(content).hexdigest()

    @staticmethod
    def to_hex(content):
        lst = []
        for ch in content:
            hv = hex(ch).replace("0x", "")
            if len(hv) == 1:
                hv = "0" + hv
            lst.append(hv)
        return reduce(operator.add, lst)

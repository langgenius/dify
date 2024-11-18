from hashlib import md5


class BaiduTranslateToolBase:
    def _get_sign(self, appid, secret, salt, query):
        """
        get baidu translate sign
        """
        # concatenate the string in the order of appid+q+salt+secret
        str = appid + query + salt + secret
        return md5(str.encode("utf-8")).hexdigest()

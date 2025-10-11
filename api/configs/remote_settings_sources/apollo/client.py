import hashlib
import json
import logging
import os
import threading
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from .python_3x import http_request, makedirs_wrapper
from .utils import (
    CONFIGURATIONS,
    NAMESPACE_NAME,
    NOTIFICATION_ID,
    get_value_from_dict,
    init_ip,
    no_key_cache_key,
    signature,
    url_encode_wrapper,
)

logger = logging.getLogger(__name__)


class ApolloClient:
    def __init__(
        self,
        config_url: str,
        app_id: str,
        cluster: str = "default",
        secret: str = "",
        start_hot_update: bool = True,
        change_listener: Callable[[str, str, str, Any], None] | None = None,
        _notification_map: dict[str, int] | None = None,
    ):
        # Core routing parameters
        self.config_url = config_url
        self.cluster = cluster
        self.app_id = app_id

        # Non-core parameters
        self.ip = init_ip()
        self.secret = secret

        # Check the parameter variables

        # Private control variables
        self._cycle_time = 5
        self._stopping = False
        self._cache: dict[str, dict[str, Any]] = {}
        self._no_key: dict[str, str] = {}
        self._hash: dict[str, str] = {}
        self._pull_timeout = 75
        self._cache_file_path = os.path.expanduser("~") + "/.dify/config/remote-settings/apollo/cache/"
        self._long_poll_thread: threading.Thread | None = None
        self._change_listener = change_listener  # "add" "delete" "update"
        if _notification_map is None:
            _notification_map = {"application": -1}
        self._notification_map = _notification_map
        self.last_release_key: str | None = None
        # Private startup method
        self._path_checker()
        if start_hot_update:
            self._start_hot_update()

        # start the heartbeat thread
        heartbeat = threading.Thread(target=self._heart_beat)
        heartbeat.daemon = True
        heartbeat.start()

    def get_json_from_net(self, namespace: str = "application") -> dict[str, Any] | None:
        url = "{}/configs/{}/{}/{}?releaseKey={}&ip={}".format(
            self.config_url, self.app_id, self.cluster, namespace, "", self.ip
        )
        try:
            code, body = http_request(url, timeout=3, headers=self._sign_headers(url))
            if code == 200:
                if not body:
                    logger.error("get_json_from_net load configs failed, body is %s", body)
                    return None
                data = json.loads(body)
                data = data["configurations"]
                return_data = {CONFIGURATIONS: data}
                return return_data
            else:
                return None
        except Exception:
            logger.exception("an error occurred in get_json_from_net")
            return None

    def get_value(self, key: str, default_val: Any = None, namespace: str = "application") -> Any:
        try:
            # read memory configuration
            namespace_cache = self._cache.get(namespace)
            val = get_value_from_dict(namespace_cache, key)
            if val is not None:
                return val

            no_key = no_key_cache_key(namespace, key)
            if no_key in self._no_key:
                return default_val

            # read the network configuration
            namespace_data = self.get_json_from_net(namespace)
            val = get_value_from_dict(namespace_data, key)
            if val is not None:
                if namespace_data is not None:
                    self._update_cache_and_file(namespace_data, namespace)
                return val

            # read the file configuration
            namespace_cache = self._get_local_cache(namespace)
            val = get_value_from_dict(namespace_cache, key)
            if val is not None:
                self._update_cache_and_file(namespace_cache, namespace)
                return val

            # If all of them are not obtained, the default value is returned
            # and the local cache is set to None
            self._set_local_cache_none(namespace, key)
            return default_val
        except Exception:
            logger.exception("get_value has error, [key is %s], [namespace is %s]", key, namespace)
            return default_val

    # Set the key of a namespace to none, and do not set default val
    # to ensure the real-time correctness of the function call.
    # If the user does not have the same default val twice
    # and the default val is used here, there may be a problem.
    def _set_local_cache_none(self, namespace: str, key: str) -> None:
        no_key = no_key_cache_key(namespace, key)
        self._no_key[no_key] = key

    def _start_hot_update(self) -> None:
        self._long_poll_thread = threading.Thread(target=self._listener)
        # When the asynchronous thread is started, the daemon thread will automatically exit
        # when the main thread is launched.
        self._long_poll_thread.daemon = True
        self._long_poll_thread.start()

    def stop(self) -> None:
        self._stopping = True
        logger.info("Stopping listener...")

    # Call the set callback function, and if it is abnormal, try it out
    def _call_listener(self, namespace: str, old_kv: dict[str, Any] | None, new_kv: dict[str, Any] | None) -> None:
        if self._change_listener is None:
            return
        if old_kv is None:
            old_kv = {}
        if new_kv is None:
            new_kv = {}
        try:
            for key in old_kv:
                new_value = new_kv.get(key)
                old_value = old_kv.get(key)
                if new_value is None:
                    # If newValue is empty, it means key, and the value is deleted.
                    self._change_listener("delete", namespace, key, old_value)
                    continue
                if new_value != old_value:
                    self._change_listener("update", namespace, key, new_value)
                    continue
            for key in new_kv:
                new_value = new_kv.get(key)
                old_value = old_kv.get(key)
                if old_value is None:
                    self._change_listener("add", namespace, key, new_value)
        except BaseException as e:
            logger.warning(str(e))

    def _path_checker(self) -> None:
        if not os.path.isdir(self._cache_file_path):
            makedirs_wrapper(self._cache_file_path)

    # update the local cache and file cache
    def _update_cache_and_file(self, namespace_data: dict[str, Any], namespace: str = "application") -> None:
        # update the local cache
        self._cache[namespace] = namespace_data
        # update the file cache
        new_string = json.dumps(namespace_data)
        new_hash = hashlib.md5(new_string.encode("utf-8")).hexdigest()
        if self._hash.get(namespace) == new_hash:
            pass
        else:
            file_path = Path(self._cache_file_path) / f"{self.app_id}_configuration_{namespace}.txt"
            file_path.write_text(new_string)
            self._hash[namespace] = new_hash

    # get the configuration from the local file
    def _get_local_cache(self, namespace: str = "application") -> dict[str, Any]:
        cache_file_path = os.path.join(self._cache_file_path, f"{self.app_id}_configuration_{namespace}.txt")
        if os.path.isfile(cache_file_path):
            with open(cache_file_path) as f:
                result = json.loads(f.readline())
            return result
        return {}

    def _long_poll(self) -> None:
        notifications: list[dict[str, Any]] = []
        for key in self._cache:
            namespace_data = self._cache[key]
            notification_id = -1
            if NOTIFICATION_ID in namespace_data:
                notification_id = self._cache[key][NOTIFICATION_ID]
            notifications.append({NAMESPACE_NAME: key, NOTIFICATION_ID: notification_id})
        try:
            # if the length is 0 it is returned directly
            if len(notifications) == 0:
                return
            url = f"{self.config_url}/notifications/v2"
            params = {
                "appId": self.app_id,
                "cluster": self.cluster,
                "notifications": json.dumps(notifications, ensure_ascii=False),
            }
            param_str = url_encode_wrapper(params)
            url = url + "?" + param_str
            code, body = http_request(url, self._pull_timeout, headers=self._sign_headers(url))
            http_code = code
            if http_code == 304:
                logger.debug("No change, loop...")
                return
            if http_code == 200:
                if not body:
                    logger.error("_long_poll load configs failed,body is %s", body)
                    return
                data = json.loads(body)
                for entry in data:
                    namespace = entry[NAMESPACE_NAME]
                    n_id = entry[NOTIFICATION_ID]
                    logger.info("%s has changes: notificationId=%d", namespace, n_id)
                    self._get_net_and_set_local(namespace, n_id, call_change=True)
                    return
            else:
                logger.warning("Sleep...")
        except Exception as e:
            logger.warning(str(e))

    def _get_net_and_set_local(self, namespace: str, n_id: int, call_change: bool = False) -> None:
        namespace_data = self.get_json_from_net(namespace)
        if not namespace_data:
            return
        namespace_data[NOTIFICATION_ID] = n_id
        old_namespace = self._cache.get(namespace)
        self._update_cache_and_file(namespace_data, namespace)
        if self._change_listener is not None and call_change and old_namespace:
            old_kv = old_namespace.get(CONFIGURATIONS)
            new_kv = namespace_data.get(CONFIGURATIONS)
            self._call_listener(namespace, old_kv, new_kv)

    def _listener(self) -> None:
        logger.info("start long_poll")
        while not self._stopping:
            self._long_poll()
            time.sleep(self._cycle_time)
        logger.info("stopped, long_poll")

    # add the need for endorsement to the header
    def _sign_headers(self, url: str) -> Mapping[str, str]:
        headers: dict[str, str] = {}
        if self.secret == "":
            return headers
        uri = url[len(self.config_url) : len(url)]
        time_unix_now = str(int(round(time.time() * 1000)))
        headers["Authorization"] = "Apollo " + self.app_id + ":" + signature(time_unix_now, uri, self.secret)
        headers["Timestamp"] = time_unix_now
        return headers

    def _heart_beat(self) -> None:
        while not self._stopping:
            for namespace in self._notification_map:
                self._do_heart_beat(namespace)
            time.sleep(60 * 10)  # 10 minutes

    def _do_heart_beat(self, namespace: str) -> None:
        url = f"{self.config_url}/configs/{self.app_id}/{self.cluster}/{namespace}?ip={self.ip}"
        try:
            code, body = http_request(url, timeout=3, headers=self._sign_headers(url))
            if code == 200:
                if not body:
                    logger.error("_do_heart_beat load configs failed,body is %s", body)
                    return None
                data = json.loads(body)
                if self.last_release_key == data["releaseKey"]:
                    return None
                self.last_release_key = data["releaseKey"]
                data = data["configurations"]
                self._update_cache_and_file(data, namespace)
            else:
                return None
        except Exception:
            logger.exception("an error occurred in _do_heart_beat")
            return None

    def get_all_dicts(self, namespace: str) -> dict[str, Any] | None:
        namespace_data = self._cache.get(namespace)
        if namespace_data is None:
            net_namespace_data = self.get_json_from_net(namespace)
            if not net_namespace_data:
                return namespace_data
            namespace_data = net_namespace_data.get(CONFIGURATIONS)
            if namespace_data:
                self._update_cache_and_file(namespace_data, namespace)
        return namespace_data

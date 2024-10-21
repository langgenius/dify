from collections.abc import Generator

from flask import Flask
from tos import TosClientV2
from tos.clientv2 import GetObjectOutput, HeadObjectOutput, PutObjectOutput

from extensions.storage.volcengine_tos_storage import VolcengineTosStorage
from tests.unit_tests.oss.__mock.volcengine_tos import (
    get_example_bucket,
    get_example_data,
    get_example_filename,
    get_example_filepath,
    setup_volcengine_tos_mock,
)


class VolcengineTosTest:
    _instance = None

    def __new__(cls):
        if cls._instance == None:
            cls._instance = object.__new__(cls)
            return cls._instance
        else:
            return cls._instance

    def __init__(self):
        self.storage = VolcengineTosStorage(app=Flask(__name__))
        self.storage.bucket_name = get_example_bucket()
        self.storage.client = TosClientV2(
            ak="dify",
            sk="dify",
            endpoint="https://xxx.volces.com",
            region="cn-beijing",
        )


def test_save(setup_volcengine_tos_mock):
    volc_tos = VolcengineTosTest()
    volc_tos.storage.save(get_example_filename(), get_example_data())


def test_load_once(setup_volcengine_tos_mock):
    volc_tos = VolcengineTosTest()
    assert volc_tos.storage.load_once(get_example_filename()) == get_example_data()


def test_load_stream(setup_volcengine_tos_mock):
    volc_tos = VolcengineTosTest()
    generator = volc_tos.storage.load_stream(get_example_filename())
    assert isinstance(generator, Generator)
    assert next(generator) == get_example_data()


def test_download(setup_volcengine_tos_mock):
    volc_tos = VolcengineTosTest()
    volc_tos.storage.download(get_example_filename(), get_example_filepath())


def test_exists(setup_volcengine_tos_mock):
    volc_tos = VolcengineTosTest()
    assert volc_tos.storage.exists(get_example_filename())


def test_delete(setup_volcengine_tos_mock):
    volc_tos = VolcengineTosTest()
    volc_tos.storage.delete(get_example_filename())

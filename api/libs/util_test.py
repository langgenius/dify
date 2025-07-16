import unittest

from apo_utils import APOUtils

class TestGetAndFillParam(unittest.TestCase):

    def test_key_exists_and_value_is_non_empty_string(self):
        """测试键存在且值为非空字符串的情况。"""
        params = {"name": "Alice", "age": "30"}
        self.assertEqual(APOUtils.get_and_fill_param(params, "name"), "Alice")
        self.assertEqual(APOUtils.get_and_fill_param(params, "age"), "30")

    def test_key_exists_and_value_is_empty_string(self):
        """测试键存在但值为**空字符串**的情况。预期返回 '.*'。"""
        params = {"city": "", "zip": ""}
        self.assertEqual(APOUtils.get_and_fill_param(params, "city"), ".*")
        self.assertEqual(APOUtils.get_and_fill_param(params, "zip"), ".*")

    def test_key_exists_and_value_is_none(self):
        """测试键存在但值为 **None** 的情况。预期返回 '.*'。"""
        params = {"description": None, "status": None}
        self.assertEqual(APOUtils.get_and_fill_param(params, "description"), ".*")
        self.assertEqual(APOUtils.get_and_fill_param(params, "status"), ".*")

    def test_key_does_not_exist(self):
        """测试键**不存在**于字典中的情况。params.get() 会返回 None，预期返回 '.*'。"""
        params = {"id": "123"}
        self.assertEqual(APOUtils.get_and_fill_param(params, "address"), ".*")

    def test_empty_params_dict(self):
        """测试输入字典为空的情况。预期返回 '.*'。"""
        params = {}
        self.assertEqual(APOUtils.get_and_fill_param(params, "some_key"), ".*")

    def test_key_exists_and_value_is_zero(self):
        """测试键存在但值为数字 0 的情况。预期返回 '.*'。"""
        params = {"count": 0}
        self.assertEqual(APOUtils.get_and_fill_param(params, "count"), ".*")

    def test_key_exists_and_value_is_false(self):
        """测试键存在但值为布尔 False 的情况。预期返回 '.*'。"""
        params = {"is_active": False}
        self.assertEqual(APOUtils.get_and_fill_param(params, "is_active"), ".*")

    def test_key_exists_and_value_is_empty_list(self):
        """测试键存在但值为空列表的情况。预期返回 '.*'。"""
        params = {"items": []}
        self.assertEqual(APOUtils.get_and_fill_param(params, "items"), ".*")

    def test_key_exists_and_value_is_empty_dict(self):
        """测试键存在但值为空字典的情况。预期返回 '.*'。"""
        params = {"data": {}}
        self.assertEqual(APOUtils.get_and_fill_param(params, "data"), ".*")

if __name__ == '__main__':
    unittest.main(argv=['first-arg-is-ignored'], exit=False)
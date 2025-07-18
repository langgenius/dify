import unittest

from apo_utils import APOUtils

class TestGetAndBuildParams(unittest.TestCase):
    
    def test_basic_functionality(self):
        """测试基本功能"""
        param = {
            'pod': 'my-pod',
            'nodeName': 'node-1',
            'pid': '12345',
            'containerId': 'container-123'
        }
        
        key_map = {
            'pod': 'pod',
            'nodeName': 'node_name',
            'pid': 'process_id',
            'containerId': 'container_id'
        }
        
        expected = {
            'pod': 'my-pod',
            'node_name': 'node-1',
            'process_id': '12345',
            'container_id': 'container-123'
        }
        
        result = APOUtils.get_and_build_params(param, key_map)
        self.assertEqual(result, expected)
    
    def test_empty_string_values(self):
        """测试空字符串值被过滤"""
        param = {
            'pod': 'my-pod',
            'nodeName': '',  # 空字符串
            'pid': '12345',
            'containerId': 'container-123'
        }
        
        key_map = {
            'pod': 'pod',
            'nodeName': 'node_name',
            'pid': 'process_id',
            'containerId': 'container_id'
        }
        
        expected = {
            'pod': 'my-pod',
            'process_id': '12345',
            'container_id': 'container-123'
        }
        
        result = APOUtils.get_and_build_params(param, key_map)
        self.assertEqual(result, expected)
    
    def test_none_values(self):
        """测试None值被过滤"""
        param = {
            'pod': 'my-pod',
            'nodeName': 'node-1',
            'pid': None,  # None值
            'containerId': 'container-123'
        }
        
        key_map = {
            'pod': 'pod',
            'nodeName': 'node_name',
            'pid': 'process_id',
            'containerId': 'container_id'
        }
        
        expected = {
            'pod': 'my-pod',
            'node_name': 'node-1',
            'container_id': 'container-123'
        }
        
        result = APOUtils.get_and_build_params(param, key_map)
        self.assertEqual(result, expected)
    
    def test_empty_list_values(self):
        """测试空列表值被过滤"""
        param = {
            'pod': 'my-pod',
            'nodeName': 'node-1',
            'tags': [],  # 空列表
            'labels': ['label1', 'label2']
        }
        
        key_map = {
            'pod': 'pod',
            'nodeName': 'node_name',
            'tags': 'resource_tags',
            'labels': 'resource_labels'
        }
        
        expected = {
            'pod': 'my-pod',
            'node_name': 'node-1',
            'resource_labels': ['label1', 'label2']
        }
        
        result = APOUtils.get_and_build_params(param, key_map)
        self.assertEqual(result, expected)
    
    def test_empty_dict_values(self):
        """测试空字典值被过滤"""
        param = {
            'pod': 'my-pod',
            'metadata': {},  # 空字典
            'config': {'key': 'value'}
        }
        
        key_map = {
            'pod': 'pod',
            'metadata': 'pod_metadata',
            'config': 'pod_config'
        }
        
        expected = {
            'pod': 'my-pod',
            'pod_config': {'key': 'value'}
        }
        
        result = APOUtils.get_and_build_params(param, key_map)
        self.assertEqual(result, expected)
    
    def test_zero_and_false_values(self):
        """测试数字0和False值不被过滤"""
        param = {
            'count': 0,
            'active': False,
            'name': 'test',
            'score': 0.0
        }
        
        key_map = {
            'count': 'item_count',
            'active': 'is_active',
            'name': 'username',
            'score': 'test_score'
        }
        
        expected = {
            'item_count': 0,
            'is_active': False,
            'username': 'test',
            'test_score': 0.0
        }
        
        result = APOUtils.get_and_build_params(param, key_map)
        self.assertEqual(result, expected)
    
    def test_missing_keys_in_param(self):
        """测试param中缺少key的情况"""
        param = {
            'pod': 'my-pod',
            'nodeName': 'node-1'
            # 缺少 pid 和 containerId
        }
        
        key_map = {
            'pod': 'pod',
            'nodeName': 'node_name',
            'pid': 'process_id',
            'containerId': 'container_id'
        }
        
        expected = {
            'pod': 'my-pod',
            'node_name': 'node-1'
        }
        
        result = APOUtils.get_and_build_params(param, key_map)
        self.assertEqual(result, expected)
    
    def test_empty_param_dict(self):
        """测试空的param字典"""
        param = {}
        
        key_map = {
            'pod': 'pod',
            'nodeName': 'node_name',
            'pid': 'process_id'
        }
        
        expected = {}
        
        result = APOUtils.get_and_build_params(param, key_map)
        self.assertEqual(result, expected)
    
    def test_empty_key_map(self):
        """测试空的key_map字典"""
        param = {
            'pod': 'my-pod',
            'nodeName': 'node-1',
            'pid': '12345'
        }
        
        key_map = {}
        
        expected = {}
        
        result = APOUtils.get_and_build_params(param, key_map)
        self.assertEqual(result, expected)
    
    def test_mixed_empty_values(self):
        """测试混合的空值情况"""
        param = {
            'pod': 'my-pod',
            'nodeName': '',
            'pid': None,
            'containerId': 'container-123',
            'tags': [],
            'metadata': {},
            'config': {'key': 'value'},
            'count': 0,
            'active': False
        }
        
        key_map = {
            'pod': 'pod',
            'nodeName': 'node_name',
            'pid': 'process_id',
            'containerId': 'container_id',
            'tags': 'resource_tags',
            'metadata': 'pod_metadata',
            'config': 'pod_config',
            'count': 'item_count',
            'active': 'is_active'
        }
        
        expected = {
            'pod': 'my-pod',
            'container_id': 'container-123',
            'pod_config': {'key': 'value'},
            'item_count': 0,
            'is_active': False
        }
        
        result = APOUtils.get_and_build_params(param, key_map)
        self.assertEqual(result, expected)
    
    def test_whitespace_strings(self):
        """测试包含空格的字符串"""
        param = {
            'pod': 'my-pod',
            'nodeName': '   ',  # 只有空格
            'pid': ' 12345 ',   # 前后有空格
            'containerId': '\t\n'  # 制表符和换行符
        }
        
        key_map = {
            'pod': 'pod',
            'nodeName': 'node_name',
            'pid': 'process_id',
            'containerId': 'container_id'
        }
        
        expected = {
            'pod': 'my-pod',
            'node_name': '   ',
            'process_id': ' 12345 ',
            'container_id': '\t\n'
        }
        
        result = APOUtils.get_and_build_params(param, key_map)
        self.assertEqual(result, expected)

if __name__ == '__main__':
    unittest.main(verbosity=2)
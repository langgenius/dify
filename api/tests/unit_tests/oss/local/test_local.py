import os
import unittest
from unittest.mock import mock_open, patch

from extensions.storage.local_storage import LocalStorage


class TestLocalStorage(unittest.TestCase):
    def setUp(self):
        # Configuration for each test
        self.app_config = {'root': '/test'}
        self.folder = 'test_folder/'
        self.storage = LocalStorage(self.app_config, self.folder)

    @patch('os.makedirs')
    def test_save(self, mock_makedirs):
        # Test the save functionality
        test_data = b"test data"
        with patch('builtins.open', mock_open()) as mocked_file:
            self.storage.save('file.txt', test_data)
            mocked_file.assert_called_with(os.path.join(os.getcwd(), 'test_folder/file.txt'), "wb")
            handle = mocked_file()
            handle.write.assert_called_once_with(test_data)

    @patch('os.path.exists', return_value=True)
    @patch('builtins.open', new_callable=mock_open, read_data=b"test data")
    def test_load_once(self, mock_open, mock_exists):
        # Test the load_once method
        data = self.storage.load_once('file.txt')
        self.assertEqual(data, b"test data")

    @patch('os.path.exists', return_value=True)
    def test_load_stream(self, mock_exists):
        # Test the load_stream method
        with patch('builtins.open', mock_open(read_data=b"test data")) as mocked_file:
            generator = self.storage.load_stream('file.txt')
            output = list(generator)
            self.assertEqual(output, [b'test data'])

    @patch('shutil.copyfile')
    @patch('os.path.exists', return_value=True)
    def test_download(self, mock_exists, mock_copyfile):
        # Test the download method
        self.storage.download('file.txt', 'target.txt')
        mock_copyfile.assert_called_once_with('test_folder/file.txt', 'target.txt')

    @patch('os.path.exists', return_value=True)
    def test_exists(self, mock_exists):
        # Test the exists method
        self.assertTrue(self.storage.exists('file.txt'))

    @patch('os.path.exists', return_value=True)
    @patch('os.remove')
    def test_delete(self, mock_remove, mock_exists):
        # Test the delete method
        self.storage.delete('file.txt')
        mock_remove.assert_called_once_with('test_folder/file.txt')

    @patch('os.path.exists', return_value=False)
    def test_delete_file_not_found(self, mock_exists):
        # Test deleting a file that does not exist
        with self.assertRaises(FileNotFoundError):
            self.storage.delete('file.txt')

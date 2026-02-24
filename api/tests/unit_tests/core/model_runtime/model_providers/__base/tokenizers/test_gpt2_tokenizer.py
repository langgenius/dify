from unittest.mock import MagicMock, patch

import core.model_runtime.model_providers.__base.tokenizers.gpt2_tokenizer as gpt2_tokenizer_module
from core.model_runtime.model_providers.__base.tokenizers.gpt2_tokenizer import GPT2Tokenizer


class TestGPT2Tokenizer:
    def setup_method(self):
        # Reset the global tokenizer before each test to ensure we test initialization
        gpt2_tokenizer_module._tokenizer = None

    def test_get_encoder_tiktoken(self):
        """
        Test that get_encoder successfully uses tiktoken when available.
        """
        mock_encoding = MagicMock()
        # Mock tiktoken to be sure it's used
        with patch("tiktoken.get_encoding", return_value=mock_encoding) as mock_get_encoding:
            encoder = GPT2Tokenizer.get_encoder()
            assert encoder == mock_encoding
            mock_get_encoding.assert_called_once_with("gpt2")

            # Verify singleton behavior within the same test
            encoder2 = GPT2Tokenizer.get_encoder()
            assert encoder2 is encoder
            assert mock_get_encoding.call_count == 1

    def test_get_encoder_tiktoken_fallback(self):
        """
        Test that get_encoder falls back to transformers when tiktoken fails.
        """
        # patch tiktoken.get_encoding to raise an exception
        with patch("tiktoken.get_encoding", side_effect=Exception("Tiktoken failure")):
            # patch transformers.GPT2Tokenizer
            with patch("transformers.GPT2Tokenizer.from_pretrained") as mock_from_pretrained:
                mock_transformer_tokenizer = MagicMock()
                mock_from_pretrained.return_value = mock_transformer_tokenizer

                with patch("core.model_runtime.model_providers.__base.tokenizers.gpt2_tokenizer.logger") as mock_logger:
                    encoder = GPT2Tokenizer.get_encoder()

                    assert encoder == mock_transformer_tokenizer
                    mock_from_pretrained.assert_called_once()
                    mock_logger.info.assert_called_once_with("Fallback to Transformers' GPT-2 tokenizer from tiktoken")

    def test_get_num_tokens(self):
        """
        Test get_num_tokens returns the correct count.
        """
        mock_encoder = MagicMock()
        mock_encoder.encode.return_value = [1, 2, 3, 4, 5]

        with patch.object(GPT2Tokenizer, "get_encoder", return_value=mock_encoder):
            tokens_count = GPT2Tokenizer.get_num_tokens("test text")
            assert tokens_count == 5
            mock_encoder.encode.assert_called_once_with("test text")

    def test_get_num_tokens_by_gpt2_direct(self):
        """
        Test _get_num_tokens_by_gpt2 directly.
        """
        mock_encoder = MagicMock()
        mock_encoder.encode.return_value = [1, 2]

        with patch.object(GPT2Tokenizer, "get_encoder", return_value=mock_encoder):
            tokens_count = GPT2Tokenizer._get_num_tokens_by_gpt2("hello")
            assert tokens_count == 2
            mock_encoder.encode.assert_called_once_with("hello")

    def test_get_encoder_already_initialized(self):
        """
        Test that if _tokenizer is already set, it returns it immediately.
        """
        mock_existing_tokenizer = MagicMock()
        gpt2_tokenizer_module._tokenizer = mock_existing_tokenizer

        # Tiktoken should not be called if already initialized
        with patch("tiktoken.get_encoding") as mock_get_encoding:
            encoder = GPT2Tokenizer.get_encoder()
            assert encoder == mock_existing_tokenizer
            mock_get_encoding.assert_not_called()

    def test_get_encoder_thread_safety(self):
        """
        Simple test to ensure the lock is used.
        """
        mock_encoding = MagicMock()
        with patch("tiktoken.get_encoding", return_value=mock_encoding):
            # We patch the lock in the module
            with patch("core.model_runtime.model_providers.__base.tokenizers.gpt2_tokenizer._lock") as mock_lock:
                encoder = GPT2Tokenizer.get_encoder()
                assert encoder == mock_encoding
                mock_lock.__enter__.assert_called_once()
                mock_lock.__exit__.assert_called_once()

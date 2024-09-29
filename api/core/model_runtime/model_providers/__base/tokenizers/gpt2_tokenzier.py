import tiktoken


class GPT2Tokenizer:
    @staticmethod
    def get_num_tokens(text: str) -> int:
        encoding = tiktoken.encoding_for_model("gpt2")
        tiktoken_vec = encoding.encode(text)
        return len(tiktoken_vec)

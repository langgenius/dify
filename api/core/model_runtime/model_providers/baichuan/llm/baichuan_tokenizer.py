import re


class BaichuanTokenizer:
    @classmethod
    def count_chinese_characters(cls, text: str) -> int:
        return len(re.findall(r'[\u4e00-\u9fa5]', text))

    @classmethod
    def count_english_vocabularies(cls, text: str) -> int:
        # remove all non-alphanumeric characters but keep spaces and other symbols like !, ., etc.
        text = re.sub(r'[^a-zA-Z0-9\s]', '', text)
        # count the number of words not characters
        return len(text.split())
    
    @classmethod
    def _get_num_tokens(cls, text: str) -> int:
        # tokens = number of Chinese characters + number of English words * 1.3 (for estimation only, subject to actual return)
        # https://platform.baichuan-ai.com/docs/text-Embedding
        return int(cls.count_chinese_characters(text) + cls.count_english_vocabularies(text) * 1.3)
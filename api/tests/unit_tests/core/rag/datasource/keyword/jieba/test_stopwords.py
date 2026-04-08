from core.rag.datasource.keyword.jieba.stopwords import STOPWORDS


def test_stopwords_loaded():
    assert isinstance(STOPWORDS, frozenset)
    assert "during" in STOPWORDS
    assert "the" in STOPWORDS

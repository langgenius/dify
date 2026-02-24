from core.model_runtime.entities.common_entities import I18nObject


class TestI18nObject:
    def test_i18n_object_with_both_languages(self):
        """
        Test I18nObject when both zh_Hans and en_US are provided.
        """
        i18n = I18nObject(zh_Hans="你好", en_US="Hello")
        assert i18n.zh_Hans == "你好"
        assert i18n.en_US == "Hello"

    def test_i18n_object_fallback_to_en_us(self):
        """
        Test I18nObject when zh_Hans is missing, it should fallback to en_US.
        """
        i18n = I18nObject(en_US="Hello")
        assert i18n.zh_Hans == "Hello"
        assert i18n.en_US == "Hello"

    def test_i18n_object_with_none_zh_hans(self):
        """
        Test I18nObject when zh_Hans is None, it should fallback to en_US.
        """
        i18n = I18nObject(zh_Hans=None, en_US="Hello")
        assert i18n.zh_Hans == "Hello"
        assert i18n.en_US == "Hello"

    def test_i18n_object_with_empty_zh_hans(self):
        """
        Test I18nObject when zh_Hans is an empty string, it should fallback to en_US.
        """
        i18n = I18nObject(zh_Hans="", en_US="Hello")
        assert i18n.zh_Hans == "Hello"
        assert i18n.en_US == "Hello"

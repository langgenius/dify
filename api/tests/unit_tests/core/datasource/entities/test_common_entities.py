from core.datasource.entities.common_entities import I18nObject


def test_i18n_object_fallback():
    # Only en_US provided
    obj = I18nObject(en_US="Hello")
    assert obj.en_US == "Hello"
    assert obj.zh_Hans == "Hello"
    assert obj.pt_BR == "Hello"
    assert obj.ja_JP == "Hello"

    # Some fields provided
    obj = I18nObject(en_US="Hello", zh_Hans="你好")
    assert obj.en_US == "Hello"
    assert obj.zh_Hans == "你好"
    assert obj.pt_BR == "Hello"
    assert obj.ja_JP == "Hello"


def test_i18n_object_all_fields():
    obj = I18nObject(en_US="Hello", zh_Hans="你好", pt_BR="Olá", ja_JP="こんにちは")
    assert obj.en_US == "Hello"
    assert obj.zh_Hans == "你好"
    assert obj.pt_BR == "Olá"
    assert obj.ja_JP == "こんにちは"


def test_i18n_object_to_dict():
    obj = I18nObject(en_US="Hello", zh_Hans="你好", pt_BR="Olá", ja_JP="こんにちは")
    expected_dict = {"en_US": "Hello", "zh_Hans": "你好", "pt_BR": "Olá", "ja_JP": "こんにちは"}
    assert obj.to_dict() == expected_dict

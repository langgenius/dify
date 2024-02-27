import json

from models.model import AppModelConfig

languages = ['en-US', 'zh-Hans', 'pt-BR', 'es-ES', 'fr-FR', 'de-DE', 'ja-JP', 'ko-KR', 'ru-RU', 'it-IT', 'uk-UA', 'vi-VN']

language_timezone_mapping = {
    'en-US': 'America/New_York',
    'zh-Hans': 'Asia/Shanghai',
    'pt-BR': 'America/Sao_Paulo',
    'es-ES': 'Europe/Madrid',
    'fr-FR': 'Europe/Paris',
    'de-DE': 'Europe/Berlin',
    'ja-JP': 'Asia/Tokyo',
    'ko-KR': 'Asia/Seoul',
    'ru-RU': 'Europe/Moscow',
    'it-IT': 'Europe/Rome',
    'uk-UA': 'Europe/Kyiv',
    'vi-VN': 'Asia/Ho_Chi_Minh',
}


def supported_language(lang):
    if lang in languages:
        return lang

    error = ('{lang} is not a valid language.'
             .format(lang=lang))
    raise ValueError(error)


user_input_form_template = {
    "en-US": [
        {
            "paragraph": {
                "label": "Query",
                "variable": "default_input",
                "required": False,
                "default": ""
            }
        }
    ],
    "zh-Hans": [
        {
            "paragraph": {
                "label": "查询内容",
                "variable": "default_input",
                "required": False,
                "default": ""
            }
        }
    ],
    "pt-BR": [
        {
            "paragraph": {
                "label": "Consulta",
                "variable": "default_input",
                "required": False,
                "default": ""
            }
        }
    ],
    "es-ES": [
        {
            "paragraph": {
                "label": "Consulta",
                "variable": "default_input",
                "required": False,
                "default": ""
            }
        }
    ],
    "ua-UK": [
        {
            "paragraph": {
                "label": "Запит",
                "variable": "default_input",
                "required": False,
                "default": ""
            }
        }
    ],
     "vi-VN": [
        {
            "paragraph": {
                "label": "Nội dung truy vấn",
                "variable": "default_input",
                "required": False,
                "default": ""
            }
        }
    ],
}

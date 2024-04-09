

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

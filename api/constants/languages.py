language_timezone_mapping = {
    "en-US": "America/New_York",
    "zh-Hans": "Asia/Shanghai",
    "zh-Hant": "Asia/Taipei",
    "pt-BR": "America/Sao_Paulo",
    "es-ES": "Europe/Madrid",
    "fr-FR": "Europe/Paris",
    "de-DE": "Europe/Berlin",
    "ja-JP": "Asia/Tokyo",
    "ko-KR": "Asia/Seoul",
    "ru-RU": "Europe/Moscow",
    "it-IT": "Europe/Rome",
    "uk-UA": "Europe/Kyiv",
    "vi-VN": "Asia/Ho_Chi_Minh",
    "ro-RO": "Europe/Bucharest",
    "pl-PL": "Europe/Warsaw",
    "hi-IN": "Asia/Kolkata",
    "tr-TR": "Europe/Istanbul",
    "fa-IR": "Asia/Tehran",
    "sl-SI": "Europe/Ljubljana",
    "th-TH": "Asia/Bangkok",
}

languages = list(language_timezone_mapping.keys())


def supported_language(lang):
    if lang in languages:
        return lang

    error = "{lang} is not a valid language.".format(lang=lang)
    raise ValueError(error)

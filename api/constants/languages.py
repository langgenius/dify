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

demo_model_templates = {
    'en-US': [
        {
            'name': 'Translation Assistant',
            'icon': '',
            'icon_background': '',
            'description': 'A multilingual translator that provides translation capabilities in multiple languages, translating user input into the language they need.',
            'mode': 'completion',
            'model_config': AppModelConfig(
                provider='openai',
                model_id='gpt-3.5-turbo-instruct',
                configs={
                    'prompt_template': "Please translate the following text into {{target_language}}:\n",
                    'prompt_variables': [
                        {
                            "key": "target_language",
                            "name": "Target Language",
                            "description": "The language you want to translate into.",
                            "type": "select",
                            "default": "Chinese",
                            'options': [
                                'Chinese',
                                'English',
                                'Japanese',
                                'French',
                                'Russian',
                                'German',
                                'Spanish',
                                'Korean',
                                'Italian',
                            ]
                        }
                    ],
                    'completion_params': {
                        'max_token': 1000,
                        'temperature': 0,
                        'top_p': 0,
                        'presence_penalty': 0.1,
                        'frequency_penalty': 0.1,
                    }
                },
                opening_statement='',
                suggested_questions=None,
                pre_prompt="Please translate the following text into {{target_language}}:\n{{query}}\ntranslate:",
                model=json.dumps({
                    "provider": "openai",
                    "name": "gpt-3.5-turbo-instruct",
                    "mode": "completion",
                    "completion_params": {
                        "max_tokens": 1000,
                        "temperature": 0,
                        "top_p": 0,
                        "presence_penalty": 0.1,
                        "frequency_penalty": 0.1
                    }
                }),
                user_input_form=json.dumps([
                    {
                        "select": {
                            "label": "Target Language",
                            "variable": "target_language",
                            "description": "The language you want to translate into.",
                            "default": "Chinese",
                            "required": True,
                            'options': [
                                'Chinese',
                                'English',
                                'Japanese',
                                'French',
                                'Russian',
                                'German',
                                'Spanish',
                                'Korean',
                                'Italian',
                            ]
                        }
                    }, {
                        "paragraph": {
                            "label": "Query",
                            "variable": "query",
                            "required": True,
                            "default": ""
                        }
                    }
                ])
            )
        },
        {
            'name': 'AI Front-end Interviewer',
            'icon': '',
            'icon_background': '',
            'description': 'A simulated front-end interviewer that tests the skill level of front-end development through questioning.',
            'mode': 'chat',
            'model_config': AppModelConfig(
                provider='openai',
                model_id='gpt-3.5-turbo',
                configs={
                    'introduction': 'Hi, welcome to our interview. I am the interviewer for this technology company, and I will test your web front-end development skills. Next, I will ask you some technical questions. Please answer them as thoroughly as possible. ',
                    'prompt_template': "You will play the role of an interviewer for a technology company, examining the user's web front-end development skills and posing 5-10 sharp technical questions.\n\nPlease note:\n- Only ask one question at a time.\n- After the user answers a question, ask the next question directly, without trying to correct any mistakes made by the candidate.\n- If you think the user has not answered correctly for several consecutive questions, ask fewer questions.\n- After asking the last question, you can ask this question: Why did you leave your last job? After the user answers this question, please express your understanding and support.\n",
                    'prompt_variables': [],
                    'completion_params': {
                        'max_token': 300,
                        'temperature': 0.8,
                        'top_p': 0.9,
                        'presence_penalty': 0.1,
                        'frequency_penalty': 0.1,
                    }
                },
                opening_statement='Hi, welcome to our interview. I am the interviewer for this technology company, and I will test your web front-end development skills. Next, I will ask you some technical questions. Please answer them as thoroughly as possible. ',
                suggested_questions=None,
                pre_prompt="You will play the role of an interviewer for a technology company, examining the user's web front-end development skills and posing 5-10 sharp technical questions.\n\nPlease note:\n- Only ask one question at a time.\n- After the user answers a question, ask the next question directly, without trying to correct any mistakes made by the candidate.\n- If you think the user has not answered correctly for several consecutive questions, ask fewer questions.\n- After asking the last question, you can ask this question: Why did you leave your last job? After the user answers this question, please express your understanding and support.\n",
                model=json.dumps({
                    "provider": "openai",
                    "name": "gpt-3.5-turbo",
                    "mode": "chat",
                    "completion_params": {
                        "max_tokens": 300,
                        "temperature": 0.8,
                        "top_p": 0.9,
                        "presence_penalty": 0.1,
                        "frequency_penalty": 0.1
                    }
                }),
                user_input_form=None
            )
        }
    ],
    'zh-Hans': [
        {
            'name': '翻译助手',
            'icon': '',
            'icon_background': '',
            'description': '一个多语言翻译器，提供多种语言翻译能力，将用户输入的文本翻译成他们需要的语言。',
            'mode': 'completion',
            'model_config': AppModelConfig(
                provider='openai',
                model_id='gpt-3.5-turbo-instruct',
                configs={
                    'prompt_template': "请将以下文本翻译为{{target_language}}:\n",
                    'prompt_variables': [
                        {
                            "key": "target_language",
                            "name": "目标语言",
                            "description": "翻译的目标语言",
                            "type": "select",
                            "default": "中文",
                            "options": [
                                "中文",
                                "英文",
                                "日语",
                                "法语",
                                "俄语",
                                "德语",
                                "西班牙语",
                                "韩语",
                                "意大利语",
                            ]
                        }
                    ],
                    'completion_params': {
                        'max_token': 1000,
                        'temperature': 0,
                        'top_p': 0,
                        'presence_penalty': 0.1,
                        'frequency_penalty': 0.1,
                    }
                },
                opening_statement='',
                suggested_questions=None,
                pre_prompt="请将以下文本翻译为{{target_language}}:\n{{query}}\n翻译:",
                model=json.dumps({
                    "provider": "openai",
                    "name": "gpt-3.5-turbo-instruct",
                    "mode": "completion",
                    "completion_params": {
                        "max_tokens": 1000,
                        "temperature": 0,
                        "top_p": 0,
                        "presence_penalty": 0.1,
                        "frequency_penalty": 0.1
                    }
                }),
                user_input_form=json.dumps([
                    {
                        "select": {
                            "label": "目标语言",
                            "variable": "target_language",
                            "description": "翻译的目标语言",
                            "default": "中文",
                            "required": True,
                            'options': [
                                "中文",
                                "英文",
                                "日语",
                                "法语",
                                "俄语",
                                "德语",
                                "西班牙语",
                                "韩语",
                                "意大利语",
                            ]
                        }
                    }, {
                        "paragraph": {
                            "label": "文本内容",
                            "variable": "query",
                            "required": True,
                            "default": ""
                        }
                    }
                ])
            )
        },
        {
            'name': 'AI 前端面试官',
            'icon': '',
            'icon_background': '',
            'description': '一个模拟的前端面试官，通过提问的方式对前端开发的技能水平进行检验。',
            'mode': 'chat',
            'model_config': AppModelConfig(
                provider='openai',
                model_id='gpt-3.5-turbo',
                configs={
                    'introduction': '你好，欢迎来参加我们的面试，我是这家科技公司的面试官，我将考察你的 Web 前端开发技能。接下来我会向您提出一些技术问题，请您尽可能详尽地回答。',
                    'prompt_template': "你将扮演一个科技公司的面试官，考察用户作为候选人的 Web 前端开发水平，提出 5-10 个犀利的技术问题。\n\n请注意：\n- 每次只问一个问题\n- 用户回答问题后请直接问下一个问题，而不要试图纠正候选人的错误；\n- 如果你认为用户连续几次回答的都不对，就少问一点；\n- 问完最后一个问题后，你可以问这样一个问题：上一份工作为什么离职？用户回答该问题后，请表示理解与支持。\n",
                    'prompt_variables': [],
                    'completion_params': {
                        'max_token': 300,
                        'temperature': 0.8,
                        'top_p': 0.9,
                        'presence_penalty': 0.1,
                        'frequency_penalty': 0.1,
                    }
                },
                opening_statement='你好，欢迎来参加我们的面试，我是这家科技公司的面试官，我将考察你的 Web 前端开发技能。接下来我会向您提出一些技术问题，请您尽可能详尽地回答。',
                suggested_questions=None,
                pre_prompt="你将扮演一个科技公司的面试官，考察用户作为候选人的 Web 前端开发水平，提出 5-10 个犀利的技术问题。\n\n请注意：\n- 每次只问一个问题\n- 用户回答问题后请直接问下一个问题，而不要试图纠正候选人的错误；\n- 如果你认为用户连续几次回答的都不对，就少问一点；\n- 问完最后一个问题后，你可以问这样一个问题：上一份工作为什么离职？用户回答该问题后，请表示理解与支持。\n",
                model=json.dumps({
                    "provider": "openai",
                    "name": "gpt-3.5-turbo",
                    "mode": "chat",
                    "completion_params": {
                        "max_tokens": 300,
                        "temperature": 0.8,
                        "top_p": 0.9,
                        "presence_penalty": 0.1,
                        "frequency_penalty": 0.1
                    }
                }),
                user_input_form=None
            )
        }
    ],
    'uk-UA': [
        {
            "name": "Помічник перекладу",
            "icon": "",
            "icon_background": "",
            "description": "Багатомовний перекладач, який надає можливості перекладу різними мовами, перекладаючи введені користувачем дані на потрібну мову.",
            "mode": "completion",
            "model_config": AppModelConfig(
                provider="openai",
                model_id="gpt-3.5-turbo-instruct",
                configs={
                    "prompt_template": "Будь ласка, перекладіть наступний текст на {{target_language}}:\n",
                    "prompt_variables": [
                        {
                            "key": "target_language",
                            "name": "Цільова мова",
                            "description": "Мова, на яку ви хочете перекласти.",
                            "type": "select",
                            "default": "Ukrainian",
                            "options": [
                                "Chinese",
                                "English",
                                "Japanese",
                                "French",
                                "Russian",
                                "German",
                                "Spanish",
                                "Korean",
                                "Italian",
                            ],
                        },
                    ],
                    "completion_params": {
                        "max_token": 1000,
                        "temperature": 0,
                        "top_p": 0,
                        "presence_penalty": 0.1,
                        "frequency_penalty": 0.1,
                    },
                },
                opening_statement="",
                suggested_questions=None,
                pre_prompt="Будь ласка, перекладіть наступний текст на {{target_language}}:\n{{query}}\ntranslate:",
                model=json.dumps({
                    "provider": "openai",
                    "name": "gpt-3.5-turbo-instruct",
                    "mode": "completion",
                    "completion_params": {
                        "max_tokens": 1000,
                        "temperature": 0,
                        "top_p": 0,
                        "presence_penalty": 0.1,
                        "frequency_penalty": 0.1,
                    },
                }),
                user_input_form=json.dumps([
                    {
                        "select": {
                            "label": "Цільова мова",
                            "variable": "target_language",
                            "description": "Мова, на яку ви хочете перекласти.",
                            "default": "Chinese",
                            "required": True,
                            'options': [
                                'Chinese',
                                'English',
                                'Japanese',
                                'French',
                                'Russian',
                                'German',
                                'Spanish',
                                'Korean',
                                'Italian',
                            ]
                        }
                    }, {
                        "paragraph": {
                            "label": "Запит",
                            "variable": "query",
                            "required": True,
                            "default": ""
                        }
                    }
                ])
            )
        },
        {
            "name": "AI інтерв’юер фронтенду",
            "icon": "",
            "icon_background": "",
            "description": "Симульований інтерв’юер фронтенду, який перевіряє рівень кваліфікації у розробці фронтенду через опитування.",
            "mode": "chat",
            "model_config": AppModelConfig(
                provider="openai",
                model_id="gpt-3.5-turbo",
                configs={
                    "introduction": "Привіт, ласкаво просимо на наше співбесіду. Я інтерв'юер цієї технологічної компанії, і я перевірю ваші навички веб-розробки фронтенду. Далі я поставлю вам декілька технічних запитань. Будь ласка, відповідайте якомога ретельніше. ",
                    "prompt_template": "Ви будете грати роль інтерв'юера технологічної компанії, перевіряючи навички розробки фронтенду користувача та ставлячи 5-10 чітких технічних питань.\n\nЗверніть увагу:\n- Ставте лише одне запитання за раз.\n- Після того, як користувач відповість на запитання, ставте наступне запитання безпосередньо, не намагаючись виправити будь-які помилки, допущені кандидатом.\n- Якщо ви вважаєте, що користувач не відповів правильно на кілька питань поспіль, задайте менше запитань.\n- Після того, як ви задали останнє запитання, ви можете поставити таке запитання: Чому ви залишили свою попередню роботу? Після того, як користувач відповість на це питання, висловіть своє розуміння та підтримку.\n",
                    "prompt_variables": [],
                    "completion_params": {
                        "max_token": 300,
                        "temperature": 0.8,
                        "top_p": 0.9,
                        "presence_penalty": 0.1,
                        "frequency_penalty": 0.1,
                    },
                },
                opening_statement="Привіт, ласкаво просимо на наше співбесіду. Я інтерв'юер цієї технологічної компанії, і я перевірю ваші навички веб-розробки фронтенду. Далі я поставлю вам декілька технічних запитань. Будь ласка, відповідайте якомога ретельніше. ",
                suggested_questions=None,
                pre_prompt="Ви будете грати роль інтерв'юера технологічної компанії, перевіряючи навички розробки фронтенду користувача та ставлячи 5-10 чітких технічних питань.\n\nЗверніть увагу:\n- Ставте лише одне запитання за раз.\n- Після того, як користувач відповість на запитання, ставте наступне запитання безпосередньо, не намагаючись виправити будь-які помилки, допущені кандидатом.\n- Якщо ви вважаєте, що користувач не відповів правильно на кілька питань поспіль, задайте менше запитань.\n- Після того, як ви задали останнє запитання, ви можете поставити таке запитання: Чому ви залишили свою попередню роботу? Після того, як користувач відповість на це питання, висловіть своє розуміння та підтримку.\n",
                model=json.dumps({
                    "provider": "openai",
                    "name": "gpt-3.5-turbo",
                    "mode": "chat",
                    "completion_params": {
                        "max_tokens": 300,
                        "temperature": 0.8,
                        "top_p": 0.9,
                        "presence_penalty": 0.1,
                        "frequency_penalty": 0.1,
                    },
                }),
                user_input_form=None
            ),
        }
    ],
    'vi-VN': [
        {
            'name': 'Trợ lý dịch thuật',
            'icon': '',
            'icon_background': '',
            'description': 'Trình dịch đa ngôn ngữ cung cấp khả năng dịch bằng nhiều ngôn ngữ, dịch thông tin đầu vào của người dùng sang ngôn ngữ họ cần.',
            'mode': 'completion',
            'model_config': AppModelConfig(
                provider='openai',
                model_id='gpt-3.5-turbo-instruct',
                configs={
                    'prompt_template': "Hãy dịch đoạn văn bản sau sang ngôn ngữ {{target_language}}:\n",
                    'prompt_variables': [
                        {
                            "key": "target_language",
                            "name": "Ngôn ngữ đích",
                            "description": "Ngôn ngữ bạn muốn dịch sang.",
                            "type": "select",
                            "default": "Vietnamese",
                            'options': [
                                'Chinese',
                                'English',
                                'Japanese',
                                'French',
                                'Russian',
                                'German',
                                'Spanish',
                                'Korean',
                                'Italian',
                                'Vietnamese',
                            ]
                        }
                    ],
                    'completion_params': {
                        'max_token': 1000,
                        'temperature': 0,
                        'top_p': 0,
                        'presence_penalty': 0.1,
                        'frequency_penalty': 0.1,
                    }
                },
                opening_statement='',
                suggested_questions=None,
                pre_prompt="Hãy dịch đoạn văn bản sau sang {{target_language}}:\n{{query}}\ndịch:",
                model=json.dumps({
                    "provider": "openai",
                    "name": "gpt-3.5-turbo-instruct",
                    "mode": "completion",
                    "completion_params": {
                        "max_tokens": 1000,
                        "temperature": 0,
                        "top_p": 0,
                        "presence_penalty": 0.1,
                        "frequency_penalty": 0.1
                    }
                }),
                user_input_form=json.dumps([
                    {
                        "select": {
                            "label": "Ngôn ngữ đích",
                            "variable": "target_language",
                            "description": "Ngôn ngữ bạn muốn dịch sang.",
                            "default": "Vietnamese",
                            "required": True,
                            'options': [
                                'Chinese',
                                'English',
                                'Japanese',
                                'French',
                                'Russian',
                                'German',
                                'Spanish',
                                'Korean',
                                'Italian',
                                'Vietnamese',
                            ]
                        }
                    }, {
                        "paragraph": {
                            "label": "Query",
                            "variable": "query",
                            "required": True,
                            "default": ""
                        }
                    }
                ])
            )
        },
        {
            'name': 'Phỏng vấn front-end AI',
            'icon': '',
            'icon_background': '',
            'description': 'Một người phỏng vấn front-end mô phỏng để kiểm tra mức độ kỹ năng phát triển front-end thông qua việc đặt câu hỏi.',
            'mode': 'chat',
            'model_config': AppModelConfig(
                provider='openai',
                model_id='gpt-3.5-turbo',
                configs={
                    'introduction': 'Xin chào, chào mừng đến với cuộc phỏng vấn của chúng tôi. Tôi là người phỏng vấn cho công ty công nghệ này và tôi sẽ kiểm tra kỹ năng phát triển web front-end của bạn. Tiếp theo, tôi sẽ hỏi bạn một số câu hỏi kỹ thuật. Hãy trả lời chúng càng kỹ lưỡng càng tốt. ',
                    'prompt_template': "Bạn sẽ đóng vai người phỏng vấn cho một công ty công nghệ, kiểm tra kỹ năng phát triển web front-end của người dùng và đặt ra 5-10 câu hỏi kỹ thuật sắc bén.\n\nXin lưu ý:\n- Mỗi lần chỉ hỏi một câu hỏi.\n - Sau khi người dùng trả lời một câu hỏi, hãy hỏi trực tiếp câu hỏi tiếp theo mà không cố gắng sửa bất kỳ lỗi nào mà thí sinh mắc phải.\n- Nếu bạn cho rằng người dùng đã không trả lời đúng cho một số câu hỏi liên tiếp, hãy hỏi ít câu hỏi hơn.\n- Sau đặt câu hỏi cuối cùng, bạn có thể hỏi câu hỏi này: Tại sao bạn lại rời bỏ công việc cuối cùng của mình? Sau khi người dùng trả lời câu hỏi này, vui lòng bày tỏ sự hiểu biết và ủng hộ của bạn.\n",
                    'prompt_variables': [],
                    'completion_params': {
                        'max_token': 300,
                        'temperature': 0.8,
                        'top_p': 0.9,
                        'presence_penalty': 0.1,
                        'frequency_penalty': 0.1,
                    }
                },
                opening_statement='Xin chào, chào mừng đến với cuộc phỏng vấn của chúng tôi. Tôi là người phỏng vấn cho công ty công nghệ này và tôi sẽ kiểm tra kỹ năng phát triển web front-end của bạn. Tiếp theo, tôi sẽ hỏi bạn một số câu hỏi kỹ thuật. Hãy trả lời chúng càng kỹ lưỡng càng tốt. ',
                suggested_questions=None,
                pre_prompt="Bạn sẽ đóng vai người phỏng vấn cho một công ty công nghệ, kiểm tra kỹ năng phát triển web front-end của người dùng và đặt ra 5-10 câu hỏi kỹ thuật sắc bén.\n\nXin lưu ý:\n- Mỗi lần chỉ hỏi một câu hỏi.\n - Sau khi người dùng trả lời một câu hỏi, hãy hỏi trực tiếp câu hỏi tiếp theo mà không cố gắng sửa bất kỳ lỗi nào mà thí sinh mắc phải.\n- Nếu bạn cho rằng người dùng đã không trả lời đúng cho một số câu hỏi liên tiếp, hãy hỏi ít câu hỏi hơn.\n- Sau đặt câu hỏi cuối cùng, bạn có thể hỏi câu hỏi này: Tại sao bạn lại rời bỏ công việc cuối cùng của mình? Sau khi người dùng trả lời câu hỏi này, vui lòng bày tỏ sự hiểu biết và ủng hộ của bạn.\n",
                model=json.dumps({
                    "provider": "openai",
                    "name": "gpt-3.5-turbo",
                    "mode": "chat",
                    "completion_params": {
                        "max_tokens": 300,
                        "temperature": 0.8,
                        "top_p": 0.9,
                        "presence_penalty": 0.1,
                        "frequency_penalty": 0.1
                    }
                }),
                user_input_form=None
            )
        }
    ],
}

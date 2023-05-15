import json

from models.model import AppModelConfig, App

model_templates = {
    # completion default mode
    'completion_default': {
        'app': {
            'mode': 'completion',
            'enable_site': True,
            'enable_api': True,
            'is_demo': False,
            'api_rpm': 0,
            'api_rph': 0,
            'status': 'normal'
        },
        'model_config': {
            'provider': 'openai',
            'model_id': 'text-davinci-003',
            'configs': {
                'prompt_template': '',
                'prompt_variables': [],
                'completion_params': {
                    'max_token': 512,
                    'temperature': 1,
                    'top_p': 1,
                    'presence_penalty': 0,
                    'frequency_penalty': 0,
                }
            },
            'model': json.dumps({
                "provider": "openai",
                "name": "text-davinci-003",
                "completion_params": {
                    "max_tokens": 512,
                    "temperature": 1,
                    "top_p": 1,
                    "presence_penalty": 0,
                    "frequency_penalty": 0
                }
            })
        }
    },

    # chat default mode
    'chat_default': {
        'app': {
            'mode': 'chat',
            'enable_site': True,
            'enable_api': True,
            'is_demo': False,
            'api_rpm': 0,
            'api_rph': 0,
            'status': 'normal'
        },
        'model_config': {
            'provider': 'openai',
            'model_id': 'gpt-3.5-turbo',
            'configs': {
                'prompt_template': '',
                'prompt_variables': [],
                'completion_params': {
                    'max_token': 512,
                    'temperature': 1,
                    'top_p': 1,
                    'presence_penalty': 0,
                    'frequency_penalty': 0,
                }
            },
            'model': json.dumps({
                "provider": "openai",
                "name": "gpt-3.5-turbo",
                "completion_params": {
                    "max_tokens": 512,
                    "temperature": 1,
                    "top_p": 1,
                    "presence_penalty": 0,
                    "frequency_penalty": 0
                }
            })
        }
    },
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
                model_id='text-davinci-003',
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
                pre_prompt="Please translate the following text into {{target_language}}:\n",
                model=json.dumps({
                    "provider": "openai",
                    "name": "text-davinci-003",
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
                model_id='text-davinci-003',
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
                pre_prompt="请将以下文本翻译为{{target_language}}:\n",
                model=json.dumps({
                    "provider": "openai",
                    "name": "text-davinci-003",
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


from core.model_runtime.entities.model_entities import DefaultParameterName

PARAMETER_RULE_TEMPLATE: dict[DefaultParameterName, dict] = {
    DefaultParameterName.TEMPERATURE: {
        'label': {
            'en_US': 'Temperature',
            'zh_Hans': '温度',
        },
        'type': 'float',
        'help': {
            'en_US': 'Controls randomness. Lower temperature results in less random completions. As the temperature approaches zero, the model will become deterministic and repetitive. Higher temperature results in more random completions.',
            'zh_Hans': '温度控制随机性。较低的温度会导致较少的随机完成。随着温度接近零，模型将变得确定性和重复性。较高的温度会导致更多的随机完成。',
        },
        'required': False,
        'default': 0.0,
        'min': 0.0,
        'max': 1.0,
        'precision': 2,
    },
    DefaultParameterName.TOP_P: {
        'label': {
            'en_US': 'Top P',
            'zh_Hans': 'Top P',
        },
        'type': 'float',
        'help': {
            'en_US': 'Controls diversity via nucleus sampling: 0.5 means half of all likelihood-weighted options are considered.',
            'zh_Hans': '通过核心采样控制多样性：0.5表示考虑了一半的所有可能性加权选项。',
        },
        'required': False,
        'default': 1.0,
        'min': 0.0,
        'max': 1.0,
        'precision': 2,
    },
    DefaultParameterName.PRESENCE_PENALTY: {
        'label': {
            'en_US': 'Presence Penalty',
            'zh_Hans': '存在惩罚',
        },
        'type': 'float',
        'help': {
            'en_US': 'Applies a penalty to the log-probability of tokens already in the text.',
            'zh_Hans': '对文本中已有的标记的对数概率施加惩罚。',
        },
        'required': False,
        'default': 0.0,
        'min': 0.0,
        'max': 1.0,
        'precision': 2,
    },
    DefaultParameterName.FREQUENCY_PENALTY: {
        'label': {
            'en_US': 'Frequency Penalty',
            'zh_Hans': '频率惩罚',
        },
        'type': 'float',
        'help': {
            'en_US': 'Applies a penalty to the log-probability of tokens that appear in the text.',
            'zh_Hans': '对文本中出现的标记的对数概率施加惩罚。',
        },
        'required': False,
        'default': 0.0,
        'min': 0.0,
        'max': 1.0,
        'precision': 2,
    },
    DefaultParameterName.MAX_TOKENS: {
        'label': {
            'en_US': 'Max Tokens',
            'zh_Hans': '最大标记',
        },
        'type': 'int',
        'help': {
            'en_US': 'Specifies the upper limit on the length of generated results. If the generated results are truncated, you can increase this parameter.',
            'zh_Hans': '指定生成结果长度的上限。如果生成结果截断，可以调大该参数。',
        },
        'required': False,
        'default': 64,
        'min': 1,
        'max': 2048,
        'precision': 0,
    },
    DefaultParameterName.RESPONSE_FORMAT: {
        'label': {
            'en_US': 'Response Format',
            'zh_Hans': '回复格式',
        },
        'type': 'string',
        'help': {
            'en_US': 'Set a response format, ensure the output from llm is a valid code block as possible, such as JSON, XML, etc.',
            'zh_Hans': '设置一个返回格式，确保llm的输出尽可能是有效的代码块，如JSON、XML等',
        },
        'required': False,
        'options': ['JSON', 'XML'],
    },
    DefaultParameterName.TOP_K: {
        'label': {
            'en_US': 'Top K',
            'zh_Hans': 'Top K',
        },
        'type': 'int',
        'help': {
            'en_US': 'The top_k parameter is used to limit the number of choices for the next predicted word or token.',
            'zh_Hans': '用于限制下一个预测单词或标记的选择数量',
        },
        'required': False,
        'default': 50,
        'min': -2147483647,
        'max': 2147483647,
        'precision': 0,
    },
    DefaultParameterName.REPETITION_PENALTY: {
        'label': {
            'en_US': 'Repetition Penalty',
            'zh_Hans': 'Repetition Penalty',
        },
        'type': 'float',
        'help': {
            'en_US': 'A number that controls the diversity of generated text by reducing the likelihood of repeated sequences. Higher values decrease repetition.',
            'zh_Hans': '通过减少重复序列的可能性来控制生成文本多样性的数字,较高的值会减少重复次数',
        },
        'required': False,
        'default': 1,
        'min': -3.4,
        'max': 3.4,
        'precision': 1,
    }
}
FUNCTION_CALLING_EXTRACTOR_NAME = 'extract_parameters'

FUNCTION_CALLING_EXTRACTOR_SYSTEM_PROMPT = f"""You are a helpful assistant that extracts structured information based on specific criteria provided. 
Generate a well-formatted output using the defined functions and arguments, always try to extract the information based on the context, including the parameter descriptions.
Based on the provided descriptions, you could understand the context and extract the information accordingly.

### Task
You need always call `{FUNCTION_CALLING_EXTRACTOR_NAME}` function with the correct parameters.

### Memory
Here is the chat histories between human and assistant, inside <histories></histories> XML tags.
<histories>
\x7bhistories\x7d
</histories>

### Instructions:
Some extra information are provided below, you should always follow the instructions as possible as you can.
<instruction>
\x7binstruction\x7d
</instruction>
"""

FUNCTION_CALLING_EXTRACTOR_EXAMPLE = [{
    'user': {
        'query': 'What is the weather today in SF?',
        'function': {
            'name': FUNCTION_CALLING_EXTRACTOR_NAME,
            'parameters': {
                'type': 'object',
                'properties': {
                    'location': {
                        'type': 'string',
                        'description': 'The location to get the weather information',
                        'required': True
                    },
                },
                'required': ['location']
            }
        }
    },
    'assistant': {
        'text': 'I need always call the function with the correct parameters. in this case, I need to call the function with the location parameter.',
        'function_call' : {
            'name': FUNCTION_CALLING_EXTRACTOR_NAME,
            'parameters': {
                'location': 'San Francisco'
            }
        }
    }
}, {
    'user': {
        'query': 'I want to eat some apple pie.',
        'function': {
            'name': FUNCTION_CALLING_EXTRACTOR_NAME,
            'parameters': {
                'type': 'object',
                'properties': {
                    'food': {
                        'type': 'string',
                        'description': 'The food to eat',
                        'required': True
                    }
                },
                'required': ['food']
            }
        }
    },
    'assistant': {
        'text': 'I need always call the function with the correct parameters. in this case, I need to call the function with the food parameter.',
        'function_call' : {
            'name': FUNCTION_CALLING_EXTRACTOR_NAME,
            'parameters': {
                'food': 'apple pie'
            }
        }
    }
}]

COMPLETION_GENERATE_JSON_PROMPT = """I need always follow the instructions and output a valid JSON object.
The structure of the JSON object I can found in the instructions, use {"result": "$answer"} as the default structure
if I are not sure about the structure.

### Memory
Here is the chat histories between human and assistant, inside <histories></histories> XML tags.
<histories>
{histories}
</histories>

### Structure
Here is the structure of the JSON object, I should always follow the structure.
<structure>
{{ structure }}
</structure>

### Instructions:
Some extra information are provided below, I should always follow the instructions as possible as I can.
<instructions>
{instruction}
</instructions>

### Text to be converted to JSON
Inside <text></text> XML tags, there is a text that I should convert to a JSON object.
<text>
{text}
</text>

### Answer
I should always output a valid JSON object.
```JSON
"""

CHAT_GENERATE_JSON_PROMPT = """You should always follow the instructions and output a valid JSON object.
The structure of the JSON object you can found in the instructions, use {"result": "$answer"} as the default structure
if you are not sure about the structure.

### Memory
Here is the chat histories between human and assistant, inside <histories></histories> XML tags.
<histories>
{histories}
</histories>

### Instructions:
Some extra information are provided below, you should always follow the instructions as possible as you can.
<instructions>
{{instructions}}
</instructions>
"""

CHAT_GENERATE_JSON_USER_MESSAGE_TEMPLATE = """### Structure
Here is the structure of the JSON object, you should always follow the structure.
<structure>
{structure}
</structure>

### Text to be converted to JSON
Inside <text></text> XML tags, there is a text that you should convert to a JSON object.
<text>
{text}
</text>
"""

CHAT_EXAMPLE = [{
    'user': {
        'query': 'What is the weather today in SF?',
        'json': {
            'type': 'object',
            'properties': {
                'location': {
                    'type': 'string',
                    'description': 'The location to get the weather information',
                    'required': True
                }
            },
            'required': ['location']
        }
    },
    'assistant': {
        'text': 'I need to output a valid JSON object.',
        'json': {
            'location': 'San Francisco'
        }
    }
}, {
    'user': {
        'query': 'I want to eat some apple pie.',
        'json': {
            'type': 'object',
            'properties': {
                'food': {
                    'type': 'string',
                    'description': 'The food to eat',
                    'required': True
                }
            },
            'required': ['food']
        }
    },
    'assistant': {
        'text': 'I need to output a valid JSON object.',
        'json': {
            'result': 'apple pie'
        }
    }
}]
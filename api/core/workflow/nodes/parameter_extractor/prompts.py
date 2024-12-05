FUNCTION_CALLING_EXTRACTOR_NAME = "extract_parameters"

FUNCTION_CALLING_EXTRACTOR_SYSTEM_PROMPT = f"""You are a helpful assistant tasked with extracting structured information based on specific criteria provided. Follow the guidelines below to ensure consistency and accuracy.
### Task
Always call the `{FUNCTION_CALLING_EXTRACTOR_NAME}` function with the correct parameters. Ensure that the information extraction is contextual and aligns with the provided criteria.
### Memory
Here is the chat history between the human and assistant, provided within <histories> tags:
<histories>
\x7bhistories\x7d
</histories>
### Instructions:
Some additional information is provided below. Always adhere to these instructions as closely as possible:
<instruction>
\x7binstruction\x7d
</instruction>
Steps:
1. Review the chat history provided within the <histories> tags.
2. Extract the relevant information based on the criteria given, output multiple values if there is multiple relevant information that match the criteria in the given text. 
3. Generate a well-formatted output using the defined functions and arguments.
4. Use the `extract_parameter` function to create structured outputs with appropriate parameters.
5. Do not include any XML tags in your output.
### Example
To illustrate, if the task involves extracting a user's name and their request, your function call might look like this: Ensure your output follows a similar structure to examples.
### Final Output
Produce well-formatted function calls in json without XML tags, as shown in the example.
"""  # noqa: E501

FUNCTION_CALLING_EXTRACTOR_USER_TEMPLATE = f"""extract structured information from context inside <context></context> XML tags by calling the function {FUNCTION_CALLING_EXTRACTOR_NAME} with the correct parameters with structure inside <structure></structure> XML tags.
<context>
\x7bcontent\x7d
</context>

<structure>
\x7bstructure\x7d
</structure>
"""  # noqa: E501

FUNCTION_CALLING_EXTRACTOR_EXAMPLE = [
    {
        "user": {
            "query": "What is the weather today in SF?",
            "function": {
                "name": FUNCTION_CALLING_EXTRACTOR_NAME,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "description": "The location to get the weather information",
                            "required": True,
                        },
                    },
                    "required": ["location"],
                },
            },
        },
        "assistant": {
            "text": "I need always call the function with the correct parameters."
            " in this case, I need to call the function with the location parameter.",
            "function_call": {"name": FUNCTION_CALLING_EXTRACTOR_NAME, "parameters": {"location": "San Francisco"}},
        },
    },
    {
        "user": {
            "query": "I want to eat some apple pie.",
            "function": {
                "name": FUNCTION_CALLING_EXTRACTOR_NAME,
                "parameters": {
                    "type": "object",
                    "properties": {"food": {"type": "string", "description": "The food to eat", "required": True}},
                    "required": ["food"],
                },
            },
        },
        "assistant": {
            "text": "I need always call the function with the correct parameters."
            " in this case, I need to call the function with the food parameter.",
            "function_call": {"name": FUNCTION_CALLING_EXTRACTOR_NAME, "parameters": {"food": "apple pie"}},
        },
    },
]

COMPLETION_GENERATE_JSON_PROMPT = """### Instructions:
Some extra information are provided below, I should always follow the instructions as possible as I can.
<instructions>
{instruction}
</instructions>

### Extract parameter Workflow
I need to extract the following information from the input text. The <information to be extracted> tag specifies the 'type', 'description' and 'required' of the information to be extracted. 
<information to be extracted>
{{ structure }}
</information to be extracted>

Step 1: Carefully read the input and understand the structure of the expected output.
Step 2: Extract relevant parameters from the provided text based on the name and description of object. 
Step 3: Structure the extracted parameters to JSON object as specified in <structure>.
Step 4: Ensure that the JSON object is properly formatted and valid. The output should not contain any XML tags. Only the JSON object should be outputted.

### Memory
Here are the chat histories between human and assistant, inside <histories></histories> XML tags.
<histories>
{histories}
</histories>

### Structure
Here is the structure of the expected output, I should always follow the output structure. 
{{γγγ
  'properties1': 'relevant text extracted from input', 
  'properties2': 'relevant text extracted from input', 
}}γγγ

### Input Text
Inside <text></text> XML tags, there is a text that I should extract parameters and convert to a JSON object.
<text>
{text}
</text>

### Answer
I should always output a valid JSON object. Output nothing other than the JSON object. 
```JSON
"""  # noqa: E501

CHAT_GENERATE_JSON_PROMPT = """You should always follow the instructions and output a valid JSON object.
The structure of the JSON object you can found in the instructions.

### Memory
Here are the chat histories between human and assistant, inside <histories></histories> XML tags.
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

CHAT_EXAMPLE = [
    {
        "user": {
            "query": "What is the weather today in SF?",
            "json": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The location to get the weather information",
                        "required": True,
                    }
                },
                "required": ["location"],
            },
        },
        "assistant": {"text": "I need to output a valid JSON object.", "json": {"location": "San Francisco"}},
    },
    {
        "user": {
            "query": "I want to eat some apple pie.",
            "json": {
                "type": "object",
                "properties": {"food": {"type": "string", "description": "The food to eat", "required": True}},
                "required": ["food"],
            },
        },
        "assistant": {"text": "I need to output a valid JSON object.", "json": {"result": "apple pie"}},
    },
]

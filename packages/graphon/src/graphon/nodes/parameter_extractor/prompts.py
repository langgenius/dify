from typing import Any

FUNCTION_CALLING_EXTRACTOR_NAME = "extract_parameters"

FUNCTION_CALLING_EXTRACTOR_SYSTEM_PROMPT = (
    "You are a helpful assistant tasked with extracting structured information "
    "based on specific criteria provided. Follow the guidelines below to ensure "
    "consistency and accuracy.\n"
    "### Task\n"
    f"Always call the `{FUNCTION_CALLING_EXTRACTOR_NAME}` function with the "
    "correct parameters. Ensure that the information extraction is contextual "
    "and aligns with the provided criteria.\n"
    "### Memory\n"
    "Here is the chat history between the human and assistant, provided within "
    "<histories> tags:\n"
    "<histories>\n"
    "\x7bhistories\x7d\n"
    "</histories>\n"
    "### Instructions:\n"
    "Some additional information is provided below. Always adhere to these "
    "instructions as closely as possible:\n"
    "<instruction>\n"
    "\x7binstruction\x7d\n"
    "</instruction>\n"
    "Steps:\n"
    "1. Review the chat history provided within the <histories> tags.\n"
    "2. Extract the relevant information based on the criteria given, output "
    "multiple values if there is multiple relevant information that match the "
    "criteria in the given text.\n"
    "3. Generate a well-formatted output using the defined functions and "
    "arguments.\n"
    f"4. Use the `{FUNCTION_CALLING_EXTRACTOR_NAME}` function to create "
    "structured outputs with "
    "appropriate parameters.\n"
    "5. Do not include any XML tags in your output.\n"
    "### Example\n"
    "To illustrate, if the task involves extracting a user's name and their "
    "request, your function call might look like this: Ensure your output "
    "follows a similar structure to examples.\n"
    "### Final Output\n"
    "Produce well-formatted function calls in json without XML tags, as shown in "
    "the example."
)

FUNCTION_CALLING_EXTRACTOR_USER_TEMPLATE = (
    f"extract structured information from context inside <context></context> XML "
    "tags by calling the function "
    f"{FUNCTION_CALLING_EXTRACTOR_NAME} with the correct parameters with "
    "structure inside <structure></structure> XML tags.\n"
    "<context>\n"
    "\x7bcontent\x7d\n"
    "</context>\n\n"
    "<structure>\n"
    "\x7bstructure\x7d\n"
    "</structure>"
)

FUNCTION_CALLING_EXTRACTOR_EXAMPLE: list[dict[str, Any]] = [
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
                            "description": (
                                "The location to get the weather information"
                            ),
                            "required": True,
                        },
                    },
                    "required": ["location"],
                },
            },
        },
        "assistant": {
            "text": (
                "I need always call the function with the correct parameters."
                " In this case, I need to call the function with the "
                "location parameter."
            ),
            "function_call": {
                "name": FUNCTION_CALLING_EXTRACTOR_NAME,
                "parameters": {"location": "San Francisco"},
            },
        },
    },
    {
        "user": {
            "query": "I want to eat some apple pie.",
            "function": {
                "name": FUNCTION_CALLING_EXTRACTOR_NAME,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "food": {
                            "type": "string",
                            "description": "The food to eat",
                            "required": True,
                        },
                    },
                    "required": ["food"],
                },
            },
        },
        "assistant": {
            "text": (
                "I need always call the function with the correct parameters."
                " In this case, I need to call the function with the "
                "food parameter."
            ),
            "function_call": {
                "name": FUNCTION_CALLING_EXTRACTOR_NAME,
                "parameters": {"food": "apple pie"},
            },
        },
    },
]

COMPLETION_GENERATE_JSON_PROMPT = (
    "### Instructions:\n"
    "Some extra information are provided below, I should always follow the "
    "instructions as possible as I can.\n"
    "<instructions>\n"
    "{instruction}\n"
    "</instructions>\n\n"
    "### Extract parameter Workflow\n"
    "I need to extract the following information from the input text. The "
    "<information to be extracted> tag specifies the 'type', 'description' and "
    "'required' of the information to be extracted.\n"
    "<information to be extracted>\n"
    "{{ structure }}\n"
    "</information to be extracted>\n\n"
    "Step 1: Carefully read the input and understand the structure of the "
    "expected output.\n"
    "Step 2: Extract relevant parameters from the provided text based on the "
    "name and description of object.\n"
    "Step 3: Structure the extracted parameters to JSON object as specified "
    "in <structure>.\n"
    "Step 4: Ensure that the JSON object is properly formatted and valid. "
    "The output should not contain any XML tags. Only the JSON object should "
    "be outputted.\n\n"
    "### Memory\n"
    "Here are the chat histories between human and assistant, inside "
    "<histories></histories> XML tags.\n"
    "<histories>\n"
    "{histories}\n"
    "</histories>\n\n"
    "### Structure\n"
    "Here is the structure of the expected output, I should always follow the "
    "output structure.\n"
    "{{γγγ\n"  # ruff:ignore[ambiguous-unicode-character-string]
    "  'properties1': 'relevant text extracted from input',\n"
    "  'properties2': 'relevant text extracted from input',\n"
    "}}γγγ\n\n"  # ruff:ignore[ambiguous-unicode-character-string]
    "### Input Text\n"
    "Inside <text></text> XML tags, there is a text that I should extract "
    "parameters and convert to a JSON object.\n"
    "<text>\n"
    "{text}\n"
    "</text>\n\n"
    "### Answer\n"
    "I should always output a valid JSON object. Output nothing other than the "
    "JSON object.\n"
    "```JSON"
)

CHAT_GENERATE_JSON_PROMPT = (
    "You should always follow the instructions and output a valid JSON object.\n"
    "The structure of the JSON object you can found in the instructions.\n\n"
    "### Memory\n"
    "Here are the chat histories between human and assistant, inside "
    "<histories></histories> XML tags.\n"
    "<histories>\n"
    "{histories}\n"
    "</histories>\n\n"
    "### Instructions:\n"
    "Some extra information are provided below, you should always follow the "
    "instructions as possible as I can.\n"
    "<instructions>\n"
    "{instruction}\n"
    "</instructions>"
)

CHAT_GENERATE_JSON_USER_MESSAGE_TEMPLATE = (
    "### Structure\n"
    "Here is the structure of the JSON object, you should always follow the "
    "structure.\n"
    "<structure>\n"
    "{structure}\n"
    "</structure>\n\n"
    "### Text to be converted to JSON\n"
    "Inside <text></text> XML tags, there is a text that you should convert to "
    "a JSON object.\n"
    "<text>\n"
    "{text}\n"
    "</text>"
)

CHAT_EXAMPLE = [
    {
        "user": {
            "query": "What is the weather today in SF?",
            "json": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": ("The location to get the weather information"),
                        "required": True,
                    },
                },
                "required": ["location"],
            },
        },
        "assistant": {
            "text": "I need to output a valid JSON object.",
            "json": {"location": "San Francisco"},
        },
    },
    {
        "user": {
            "query": "I want to eat some apple pie.",
            "json": {
                "type": "object",
                "properties": {
                    "food": {
                        "type": "string",
                        "description": "The food to eat",
                        "required": True,
                    },
                },
                "required": ["food"],
            },
        },
        "assistant": {
            "text": "I need to output a valid JSON object.",
            "json": {"food": "apple pie"},
        },
    },
]

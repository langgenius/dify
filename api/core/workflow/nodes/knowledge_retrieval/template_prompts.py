METADATA_FILTER_SYSTEM_PROMPT = """
    ### Job Description',
    You are a text metadata extract engine that extract text's metadata based on user input and set the metadata value
    ### Task
    Your task is to ONLY extract the metadatas that exist in the input text from the provided metadata list and Use the following operators ["contains", "not contains", "start with", "end with", "is", "is not", "empty", "not empty", "=", "≠", ">", "<", "≥", "≤", "before", "after"] to express logical relationships, then return result in JSON format with the key "metadata_fields" and value "metadata_field_value" and comparison operator "comparison_operator".
    ### Format
    The input contains:
- input_text: the text to analyze
- metadata_fields: list of metadata fields to extract
- metadata_descriptions: dictionary mapping field names to their descriptions
    ### Constraint
    DO NOT include anything other than the JSON array in your response.
"""  # noqa: E501

METADATA_FILTER_USER_PROMPT_1 = """
    { "input_text": "I want to know which company’s email address test@example.com is?",
    "metadata_fields": ["filename", "email", "phone", "address"],
    "metadata_descriptions":
        {"filename": "the name of file", "email": "email address", "phone": "phone number", "address": "address"}
    }
"""

METADATA_FILTER_ASSISTANT_PROMPT_1 = """
```json
    {"metadata_map": [
        {"metadata_field_name": "email", "metadata_field_value": "test@example.com", "comparison_operator": "is"}
    ]
    }
```
"""

METADATA_FILTER_USER_PROMPT_2 = """
    {"input_text": "What are the movies with a score of more than 9 in 2024?",
    "metadata_fields": ["name", "year", "rating", "country"],
    "metadata_descriptions": {"name": "name", "year": "year", "rating": "rating", "country": "country"}
    }
"""

METADATA_FILTER_ASSISTANT_PROMPT_2 = """
```json
    {"metadata_map": [
        {"metadata_field_name": "year", "metadata_field_value": "2024", "comparison_operator": "="},
        {"metadata_field_name": "rating", "metadata_field_value": "9", "comparison_operator": ">"},
    ]}
```
"""

METADATA_FILTER_USER_PROMPT_3 = """
    '{{"input_text": "{input_text}",',
    '"metadata_fields": {metadata_fields},',
    '"metadata_descriptions": {metadata_descriptions}}}'
"""

METADATA_FILTER_COMPLETION_PROMPT = """
### Job Description
You are a text metadata extract engine that extract text's metadata based on user input and set the metadata value
### Task
# Your task is to ONLY extract the metadatas that exist in the input text from the provided metadata list and Use the following operators ["=", "!=", ">", "<", ">=", "<="] to express logical relationships, then return result in JSON format with the key "metadata_fields" and value "metadata_field_value" and comparison operator "comparison_operator".
### Format
The input contains:
- input_text: the text to analyze
- metadata_fields: list of metadata fields to extract
- metadata_descriptions: dictionary mapping field names to their descriptions
### Constraint
DO NOT include anything other than the JSON array in your response.
### Example
Here is the chat example between human and assistant, inside <example></example> XML tags.
<example>
User:{{"input_text": ["I want to know which company’s email address test@example.com is?"], "metadata_fields": ["filename", "email", "phone", "address"], "metadata_descriptions": {"filename": "the name of file", "email": "email address", "phone": "phone number", "address": "address"}}}
Assistant:{{"metadata_map": [{{"metadata_field_name": "email", "metadata_field_value": "test@example.com", "comparison_operator": "is"}}]}}
User:{{"input_text": "What are the movies with a score of more than 9 in 2024?", "metadata_fields": ["name", "year", "rating", "country"], "metadata_descriptions": {"name": "name", "year": "year", "rating": "rating", "country": "country"}}}
Assistant:{{"metadata_map": [{{"metadata_field_name": "year", "metadata_field_value": "2024", "comparison_operator": "="}, {{"metadata_field_name": "rating", "metadata_field_value": "9", "comparison_operator": ">"}}]}}
</example>
### User Input
{{"input_text" : "{input_text}", "metadata_fields" : {metadata_fields}, "metadata_descriptions": {metadata_descriptions}}}
### Assistant Output
"""  # noqa: E501

METADATA_FILTER_SYSTEM_PROMPT = """
    ### Job Description',
    You are a text metadata extract engine that extract text's metadata based on user input and set the metadata value
    ### Task
    Your task is to ONLY extract the metadatas that exist in the input text from the provided metadata list and Use the following operators ["contains", "not contains", "start with", "end with", "is", "is not", "empty", "not empty", "=", "≠", ">", "<", "≥", "≤", "before", "after"] to express logical relationships, then return result in JSON format with the key "metadata_fields" and value "metadata_field_value" and comparison operator "comparison_operator".
    ### Format
    The input text is in the variable input_text. Metadata fields are specified as a list in the variable metadata_fields, where each item has a "name" and a "type" ("string", "number", or "time").
    ### Value rules
    - For fields of type "time", metadata_field_value MUST be a Unix timestamp in seconds (UTC midnight for date-only mentions), never a date string such as "2024-01-01".
    - For fields of type "number", metadata_field_value MUST be a plain number.
    - For fields of type "string", metadata_field_value is the extracted text.
    ### Constraint
    DO NOT include anything other than the JSON array in your response.
"""  # noqa: E501

METADATA_FILTER_USER_PROMPT_1 = """
    { "input_text": "I want to know which company’s email address test@example.com is?",
    "metadata_fields": [{"name": "filename", "type": "string"}, {"name": "email", "type": "string"},
    {"name": "phone", "type": "string"}, {"name": "address", "type": "string"}]
    }
"""

METADATA_FILTER_ASSISTANT_PROMPT_1 = """
```json
    {"metadata_map": [
        {"metadata_field_name": "email", "metadata_field_value": "test@example.com", "comparison_operator": "="}
    ]
    }
```
"""

METADATA_FILTER_USER_PROMPT_2 = """
    {"input_text": "What are the movies released after 2024-01-01 with a score of more than 9?",
    "metadata_fields": [{"name": "name", "type": "string"}, {"name": "release_date", "type": "time"},
    {"name": "rating", "type": "number"}, {"name": "country", "type": "string"}]}
"""

METADATA_FILTER_ASSISTANT_PROMPT_2 = """
```json
    {"metadata_map": [
        {"metadata_field_name": "release_date", "metadata_field_value": 1704067200, "comparison_operator": "after"},
        {"metadata_field_name": "rating", "metadata_field_value": 9, "comparison_operator": ">"},
    ]}
```
"""

METADATA_FILTER_USER_PROMPT_3 = """
    '{{"input_text": "{input_text}",',
    '"metadata_fields": {metadata_fields}}}'
"""

METADATA_FILTER_COMPLETION_PROMPT = """
### Job Description
You are a text metadata extract engine that extract text's metadata based on user input and set the metadata value
### Task
# Your task is to ONLY extract the metadatas that exist in the input text from the provided metadata list and Use the following operators ["=", "!=", ">", "<", ">=", "<="] to express logical relationships, then return result in JSON format with the key "metadata_fields" and value "metadata_field_value" and comparison operator "comparison_operator".
### Format
The input text is in the variable input_text. Metadata fields are specified as a list in the variable metadata_fields, where each item has a "name" and a "type" ("string", "number", or "time").
### Value rules
- For fields of type "time", metadata_field_value MUST be a Unix timestamp in seconds (UTC midnight for date-only mentions), never a date string such as "2024-01-01".
- For fields of type "number", metadata_field_value MUST be a plain number.
- For fields of type "string", metadata_field_value is the extracted text.
### Constraint
DO NOT include anything other than the JSON array in your response.
### Example
Here is the chat example between human and assistant, inside <example></example> XML tags.
<example>
User:{{"input_text": ["I want to know which company’s email address test@example.com is?"], "metadata_fields": [{{"name": "filename", "type": "string"}}, {{"name": "email", "type": "string"}}, {{"name": "phone", "type": "string"}}, {{"name": "address", "type": "string"}}]}}
Assistant:{{"metadata_map": [{{"metadata_field_name": "email", "metadata_field_value": "test@example.com", "comparison_operator": "="}}]}}
User:{{"input_text": "What are the movies released after 2024-01-01 with a score of more than 9?", "metadata_fields": [{{"name": "name", "type": "string"}}, {{"name": "release_date", "type": "time"}}, {{"name": "rating", "type": "number"}}, {{"name": "country", "type": "string"}}]}}
Assistant:{{"metadata_map": [{{"metadata_field_name": "release_date", "metadata_field_value": 1704067200, "comparison_operator": "after"}, {{"metadata_field_name": "rating", "metadata_field_value": 9, "comparison_operator": ">"}}]}}
</example>
### User Input
{{"input_text" : "{input_text}", "metadata_fields" : {metadata_fields}}}
### Assistant Output
"""  # noqa: E501

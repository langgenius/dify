STRUCTURED_OUTPUT_PROMPT = """
You’re a helpful AI assistant. You could answer questions and output in JSON format.

eg1:
    Here is the JSON schema:
    {"additionalProperties": false, "properties": {"age": {"type": "number"}, "name": {"type": "string"}}, "required": ["name", "age"], "type": "object"}

    Here is the user's question:
    My name is John Doe and I am 30 years old.

    output:
    {"name": "John Doe", "age": 30}
    
Here is the JSON schema:
{{schema}}

Here is the user's question:
{{question}}
output:

"""  # noqa: E501

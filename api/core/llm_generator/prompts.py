# Written by YORKI MINAKO🤡, Edited by Xiaoyi, Edited by yasu-oh

import json
from collections.abc import Mapping, Sequence

from core.llm_generator.decision_generator import format_operator_table

CONVERSATION_TITLE_PROMPT = """You are asked to generate a concise chat title by decomposing the user’s input into two parts: “Intention” and “Subject”.

1. Detect Input Language
Automatically identify the language of the user’s input (e.g. English, Chinese, Italian, Español, Arabic, Japanese, French, and etc.).

2. Generate Title
- Combine Intention + Subject into a single, as-short-as-possible phrase.
- The title must be natural, friendly, and in the same language as the input.
- If the input is a direct question to the model, you may add an emoji at the end.

3. Output Format
Return **only** a valid JSON object with these exact keys and no additional text:
{
  "Language Type": "<Detected language>",
  "Your Reasoning": "<Brief explanation in that language>",
  "Your Output": "<Intention + Subject>"
}

User Input:
"""  # noqa: E501

PYTHON_CODE_GENERATOR_PROMPT_TEMPLATE = (
    "You are an expert programmer. Generate code based on the following instructions:\n\n"
    "Instructions: {{INSTRUCTION}}\n\n"
    "Write the code in {{CODE_LANGUAGE}}.\n\n"
    "Please ensure that you meet the following requirements:\n"
    "1. Define a function named 'main'.\n"
    "2. The 'main' function must return a dictionary (dict).\n"
    "3. You may modify the arguments of the 'main' function, but include appropriate type hints.\n"
    "4. The returned dictionary should contain at least one key-value pair.\n\n"
    "5. You may ONLY use the following libraries in your code: \n"
    "- json\n"
    "- datetime\n"
    "- math\n"
    "- random\n"
    "- re\n"
    "- string\n"
    "- sys\n"
    "- time\n"
    "- traceback\n"
    "- uuid\n"
    "- os\n"
    "- base64\n"
    "- hashlib\n"
    "- hmac\n"
    "- binascii\n"
    "- collections\n"
    "- functools\n"
    "- operator\n"
    "- itertools\n\n"
    "Example:\n"
    "def main(arg1: str, arg2: int) -> dict:\n"
    "    return {\n"
    '        "result": arg1 * arg2,\n'
    "    }\n\n"
    "IMPORTANT:\n"
    "- Provide ONLY the code without any additional explanations, comments, or markdown formatting.\n"
    "- DO NOT use markdown code blocks (``` or ``` python). Return the raw code directly.\n"
    "- The code should start immediately after this instruction, without any preceding newlines or spaces.\n"
    "- The code should be complete, functional, and follow best practices for {{CODE_LANGUAGE}}.\n\n"
    "- Always use the format return {'result': ...} for the output.\n\n"
    "Generated Code:\n"
)
JAVASCRIPT_CODE_GENERATOR_PROMPT_TEMPLATE = (
    "You are an expert programmer. Generate code based on the following instructions:\n\n"
    "Instructions: {{INSTRUCTION}}\n\n"
    "Write the code in {{CODE_LANGUAGE}}.\n\n"
    "Please ensure that you meet the following requirements:\n"
    "1. Define a function named 'main'.\n"
    "2. The 'main' function must return an object.\n"
    "3. You may modify the arguments of the 'main' function, but include appropriate JSDoc annotations.\n"
    "4. The returned object should contain at least one key-value pair.\n\n"
    "5. The returned object should always be in the format: {result: ...}\n\n"
    "Example:\n"
    "/**\n"
    " * Multiplies two numbers together.\n"
    " *\n"
    " * @param {number} arg1 - The first number to multiply.\n"
    " * @param {number} arg2 - The second number to multiply.\n"
    " * @returns {{ result: number }} The result of the multiplication.\n"
    " */\n"
    "function main(arg1, arg2) {\n"
    "    return {\n"
    "        result: arg1 * arg2\n"
    "    };\n"
    "}\n\n"
    "IMPORTANT:\n"
    "- Provide ONLY the code without any additional explanations, comments, or markdown formatting.\n"
    "- DO NOT use markdown code blocks (``` or ``` javascript). Return the raw code directly.\n"
    "- The code should start immediately after this instruction, without any preceding newlines or spaces.\n"
    "- The code should be complete, functional, and follow best practices for {{CODE_LANGUAGE}}.\n\n"
    "Generated Code:\n"
)


# Default prompt and model parameters for suggested questions.
DEFAULT_SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT = (
    "Please help me predict the three most likely questions that human would ask, "
    "and keep each question under 20 characters.\n"
    "MAKE SURE your output is the SAME language as the Assistant's latest response. "
    "The output must be an array in JSON format following the specified schema:\n"
    '["question1","question2","question3"]\n'
)

GENERATOR_QA_PROMPT = (
    "<Task> The user will send a long text. Generate a Question and Answer pairs only using the knowledge"
    " in the long text. Please think step by step."
    "Step 1: Understand and summarize the main content of this text.\n"
    "Step 2: What key information or concepts are mentioned in this text?\n"
    "Step 3: Decompose or combine multiple pieces of information and concepts.\n"
    "Step 4: Generate questions and answers based on these key information and concepts.\n"
    "<Constraints> The questions should be clear and detailed, and the answers should be detailed and complete. "
    "You must answer in {language}, in a style that is clear and detailed in {language}."
    " No language other than {language} should be used. \n"
    "<Format> Use the following format: Q1:\nA1:\nQ2:\nA2:...\n"
    "<QA Pairs>"
)

WORKFLOW_RULE_CONFIG_PROMPT_GENERATE_TEMPLATE = """
Here is a task description for which I would like you to create a high-quality prompt template for:
<task_description>
{{TASK_DESCRIPTION}}
</task_description>
Based on task description, please create a well-structured prompt template that another AI could use to consistently complete the task. The prompt template should include:
- Do not include <input> or <output> section and variables in the prompt, assume user will add them at their own will.
- Clear instructions for the AI that will be using this prompt, demarcated with <instruction> tags. The instructions should provide step-by-step directions on how to complete the task using the input variables. Also Specifies in the instructions that the output should not contain any xml tag.
- Relevant examples if needed to clarify the task further, demarcated with <example> tags. Do not include variables in the prompt. Give three pairs of input and output examples.
- Include other relevant sections demarcated with appropriate XML tags like <examples>, <instruction>.
- Use the same language as task description.
- Output in ``` xml ``` and start with <instruction>
Please generate the full prompt template with at least 300 words and output only the prompt template.
"""  # noqa: E501

RULE_CONFIG_PROMPT_GENERATE_TEMPLATE = """
Here is a task description for which I would like you to create a high-quality prompt template for:
<task_description>
{{TASK_DESCRIPTION}}
</task_description>
Based on task description, please create a well-structured prompt template that another AI could use to consistently complete the task. The prompt template should include:
- Descriptive variable names surrounded by {{ }} (two curly brackets) to indicate where the actual values will be substituted in. Choose variable names that clearly indicate the type of value expected. Variable names have to be composed of number, english alphabets and underline and nothing else.
- Clear instructions for the AI that will be using this prompt, demarcated with <instruction> tags. The instructions should provide step-by-step directions on how to complete the task using the input variables. Also Specifies in the instructions that the output should not contain any xml tag.
- Relevant examples if needed to clarify the task further, demarcated with <example> tags. Do not use curly brackets any other than in <instruction> section.
- Any other relevant sections demarcated with appropriate XML tags like <input>, <output>, etc.
- Use the same language as task description.
- Output in ``` xml ``` and start with <instruction>
Please generate the full prompt template and output only the prompt template.
"""  # noqa: E501

RULE_CONFIG_PARAMETER_GENERATE_TEMPLATE = """
I need to extract the following information from the input text. The <information to be extracted> tag specifies the 'type', 'description' and 'required' of the information to be extracted.
<information to be extracted>
variables name bounded two double curly brackets. Variable name has to be composed of number, english alphabets and underline and nothing else.
</information to be extracted>

Step 1: Carefully read the input and understand the structure of the expected output.
Step 2: Extract relevant parameters from the provided text based on the name and description of object.
Step 3: Structure the extracted parameters to JSON object as specified in <structure>.
Step 4: Ensure that the list of variable_names is properly formatted and valid. The output should not contain any XML tags. Output an empty list if there is no valid variable name in input text.

### Structure
Here is the structure of the expected output, I should always follow the output structure.
["variable_name_1", "variable_name_2"]

### Input Text
Inside <text></text> XML tags, there is a text that I should extract parameters and convert to a JSON object.
<text>
{{INPUT_TEXT}}
</text>

### Answer
I should always output a valid list. Output nothing other than the list of variable_name. Output an empty list if there is no variable name in input text.
"""  # noqa: E501

RULE_CONFIG_STATEMENT_GENERATE_TEMPLATE = """
<instruction>
Step 1: Identify the purpose of the chatbot from the variable {{TASK_DESCRIPTION}} and infer chatbot's tone  (e.g., friendly, professional, etc.) to add personality traits.
Step 2: Create a coherent and engaging opening statement.
Step 3: Ensure the output is welcoming and clearly explains what the chatbot is designed to do. Do not include any XML tags in the output.
Please use the same language as the user's input language. If user uses chinese then generate opening statement in chinese,  if user uses english then generate opening statement in english.
Example Input:
Provide customer support for an e-commerce website
Example Output:
Welcome! I'm here to assist you with any questions or issues you might have with your shopping experience. Whether you're looking for product information, need help with your order, or have any other inquiries, feel free to ask. I'm friendly, helpful, and ready to support you in any way I can.
<Task>
Here is the task description: {{INPUT_TEXT}}

You just need to generate the output
"""  # noqa: E501

SYSTEM_STRUCTURED_OUTPUT_GENERATE = """
Your task is to convert simple user descriptions into properly formatted JSON Schema definitions. When a user describes data fields they need, generate a complete, valid JSON Schema that accurately represents those fields with appropriate types and requirements.

## Instructions:

1. Analyze the user's description of their data needs
2. Identify each property that should be included in the schema
3. Determine the appropriate data type for each property
4. Decide which properties should be required
5. Generate a complete JSON Schema with proper syntax
6. Include appropriate constraints when specified (min/max values, patterns, formats)
7. Provide ONLY the JSON Schema without any additional explanations, comments, or markdown formatting.
8. DO NOT use markdown code blocks (``` or ``` json). Return the raw JSON Schema directly.

## Examples:

### Example 1:
**User Input:** I need name and age
**JSON Schema Output:**
{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "age": { "type": "number" }
  },
  "required": ["name", "age"]
}

### Example 2:
**User Input:** I want to store information about books including title, author, publication year and optional page count
**JSON Schema Output:**
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "author": { "type": "string" },
    "publicationYear": { "type": "integer" },
    "pageCount": { "type": "integer" }
  },
  "required": ["title", "author", "publicationYear"]
}

### Example 3:
**User Input:** Create a schema for user profiles with email, password, and age (must be at least 18)
**JSON Schema Output:**
{
  "type": "object",
  "properties": {
    "email": {
      "type": "string",
      "format": "email"
    },
    "password": {
      "type": "string",
      "minLength": 8
    },
    "age": {
      "type": "integer",
      "minimum": 18
    }
  },
  "required": ["email", "password", "age"]
}

### Example 4:
**User Input:** I need album schema, the album has songs, and each song has name, duration, and artist.
**JSON Schema Output:**
{
    "type": "object",
    "properties": {
        "songs": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string"
                    },
                    "id": {
                        "type": "string"
                    },
                    "duration": {
                        "type": "string"
                    },
                    "artist": {
                        "type": "string"
                    }
                },
                "required": [
                    "name",
                    "id",
                    "duration",
                    "artist"
                ]
            }
        }
    },
    "required": [
        "songs"
    ]
}

Now, generate a JSON Schema based on my description
"""  # noqa: E501

STRUCTURED_OUTPUT_PROMPT = """You’re a helpful AI assistant. You could answer questions and output in JSON format.
constraints:
    - You must output in JSON format.
    - Strictly follow the provided JSON schema, including all field types.
    - Use JSON true or false for boolean values, never strings.
    - Use JSON numbers for numeric fields and JSON null where allowed by the schema.
eg:
    Here is the JSON schema:
    {"additionalProperties": false, "properties": {"age": {"type": "number"}, "name": {"type": "string"}, "is_active": {"type": "boolean"}}, "required": ["name", "age", "is_active"], "type": "object"}

    Here is the user's question:
    My name is John Doe, I am 30 years old, and my account is active.

    output:
    {"name": "John Doe", "age": 30, "is_active": true}
Here is the JSON schema:
{{schema}}
"""  # noqa: E501

LLM_MODIFY_PROMPT_SYSTEM = """
Both your input and output should be in JSON format.

! Below is the schema for input content !
{
    "type": "object",
    "description": "The user is trying to process some content with a prompt, but the output is not as expected. They hope to achieve their goal by modifying the prompt.",
    "properties": {
        "current": {
            "type": "string",
            "description": "The prompt before modification, where placeholders {{}} will be replaced with actual values for the large language model. The content in the placeholders should not be changed."
        },
        "last_run": {
            "type": "object",
            "description": "The output result from the large language model after receiving the prompt.",
        },
        "instruction": {
            "type": "string",
            "description": "User's instruction to edit the current prompt"
        },
        "ideal_output": {
            "type": "string",
            "description": "The ideal output that the user expects from the large language model after modifying the prompt. You should compare the last output with the ideal output and make changes to the prompt to achieve the goal."
        }
    }
}
! Above is the schema for input content !

! Below is the schema for output content !
{
    "type": "object",
    "description": "Your feedback to the user after they provide modification suggestions.",
    "properties": {
        "modified": {
            "type": "string",
            "description": "Your modified prompt. You should change the original prompt as little as possible to achieve the goal. Keep the language of prompt if not asked to change"
        },
        "message": {
            "type": "string",
            "description": "Your feedback to the user, in the user's language, explaining what you did and your thought process in text, providing sufficient emotional value to the user."
        }
    },
    "required": [
        "modified",
        "message"
    ]
}
! Above is the schema for output content !

Your output must strictly follow the schema format, do not output any content outside of the JSON body.
"""  # noqa: E501

LLM_MODIFY_CODE_SYSTEM = """
Both your input and output should be in JSON format.

! Below is the schema for input content !
{
    "type": "object",
    "description": "The user is trying to process some data with a code snippet, but the result is not as expected. They hope to achieve their goal by modifying the code.",
    "properties": {
        "current": {
            "type": "string",
            "description": "The code before modification."
        },
        "last_run": {
            "type": "object",
            "description": "The result of the code.",
        },
        "message": {
            "type": "string",
            "description": "User's instruction to edit the current code"
        }
    }
}
! Above is the schema for input content !

! Below is the schema for output content !
{
    "type": "object",
    "description": "Your feedback to the user after they provide modification suggestions.",
    "properties": {
        "modified": {
            "type": "string",
            "description": "Your modified code. You should change the original code as little as possible to achieve the goal. Keep the programming language of code if not asked to change"
        },
        "message": {
            "type": "string",
            "description": "Your feedback to the user, in the user's language, explaining what you did and your thought process in text, providing sufficient emotional value to the user."
        }
    },
    "required": [
        "modified",
        "message"
    ]
}
! Above is the schema for output content !

When you are modifying the code, you should remember:
- Do not use print, this not work in dify sandbox.
- Do not try dangerous call like deleting files. It's PROHIBITED.
- Do not use any library that is not built-in with Python.
- Get inputs from the parameters of the function and have explicit type annotations.
- Write proper imports at the top of the code.
- Use return statement to return the result.
- You should return a `dict`. If you need to return a `result: str`, you should `return {"result": result}`.
Your output must strictly follow the schema format, do not output any content outside of the JSON body.
"""  # noqa: E501

INSTRUCTION_GENERATE_TEMPLATE_PROMPT = """The output of this prompt is not as expected: {{#last_run#}}.
You should edit the prompt according to the IDEAL OUTPUT."""

INSTRUCTION_GENERATE_TEMPLATE_CODE = """Please fix the errors in the {{#error_message#}}."""

DEFAULT_GENERATOR_SUMMARY_PROMPT = (
    """Summarize the following content. Extract only the key information and main points. """
    """Remove redundant details.

Requirements:
1. Write a concise summary in plain text
2. You must write in {language}. No language other than {language} should be used.
3. Focus on important facts, concepts, and details
4. If images are included, describe their key information
5. Do not use words like "好的", "ok", "I understand", "This text discusses", "The content mentions"
6. Write directly without extra words
7. If there is not enough content to generate a meaningful summary,
   return an empty string without any explanation or prompt

Output only the summary text. Start summarizing now:

"""
)


# ── Decision node configuration generator ───────────────────────────────────
# The system prompt is the contract for one generation roundtrip; the user
# message (``build_decision_generate_user_content``) carries the sentence, the
# variables, the author's existing outcomes and, on the repair retry, the
# validation errors from the previous attempt.

DECISION_GENERATE_SYSTEM = f"""You configure a Dify "decision" workflow node from one sentence written by its author. \
The author names the business outcomes; you produce the node's configuration: how to decide, the outcomes, \
the fallback exit, and — only when asked — extra outputs.

## How to decide

- Choose "rules" when every outcome can be decided by comparing variable values from the available variables.
- Choose "llm" when any outcome needs understanding the meaning of free text.
- Set "decide_by" to "rules" or "llm" and write "decide_by_reason": one short sentence saying why this mode fits.
- Never choose or invent any other mode.

## Outcomes

- Outcome labels are business results in the author's words. Never use IF, ELSE, CASE 1, CLASS 1 or similar filler.
- "when" depends on the mode:
  - rules: a rule group object, e.g.
    {{"logical_operator": "and", "conditions": [{{"variable_selector": ["start", "amount"], "comparison_operator": ">", "value": "500"}}]}}
  - llm: one short sentence saying when the outcome applies.
- Always also write "when_description": one short sentence saying when the outcome applies. It is kept for display, never executed.
- Rules are evaluated in list order and the first matching outcome wins; order the outcomes accordingly.
- When the author already listed outcomes, keep their ids and labels exactly, in the same order, and only write their "when". \
You may append new outcomes only when the instruction clearly needs them.
- "otherwise" only holds a short label meaning "none of the above or unable to tell" (for example "Can't decide"). \
Never add conditions to it and never invent an outcome named otherwise.

## Rules mode

- Every "variable_selector" must be exactly one of the available variables.
- The comparison operator must be legal for that variable's type:
{format_operator_table()}
- Write numbers as strings ("500", not 500).
- For "empty", "not empty", "null" and "not null" do not write a "value" at all.

## llm mode

- "inputs" lists the variables the deciding model should be given, chosen from the available variables: \
[{{"variable": "<short name>", "value_selector": [...]}}]. List only the ones needed to decide.

## extras

- Only when the instruction explicitly asks for additional information to be passed on (for example "and also give the urgency") \
add extras: {{"name": "<output name>", "from": "fixed", "values": {{"<outcome id>": <value>}}}} or \
{{"name": "<output name>", "from": "model", "hint": "<what the model should write>"}}. Otherwise return an empty list.
- The "name" of an extra is a short ASCII snake_case identifier: letters, digits and underscores, starting with a letter or underscore, \
at most 30 characters — for example "urgency_level". Never name an extra "outcome", "outcome_id", "reason" or "decided_by".
- The human wording is never in the name: the "hint" carries it, written in the author's language.

## Output

Return only one JSON object, no code fence, no commentary:
{{
  "decide_by": "rules" | "llm",
  "decide_by_reason": "<one short sentence>",
  "outcomes": [
    {{"id": "<snake_case id>", "label": "<business result in the author's words>", "when": <rule group or sentence>, "when_description": "<one short sentence>"}}
  ],
  "otherwise": {{"label": "<none of the above or unable to tell, in the author's words>"}},
  "inputs": [{{"variable": "<short name>", "value_selector": [...]}}],
  "extras": []
}}
"""  # noqa: E501


def build_decision_generate_user_content(
    *,
    instruction: str,
    available_variables: Sequence[Mapping[str, object]],
    decide_by: str | None,
    decide_by_note: str,
    outcomes: Sequence[Mapping[str, object]],
    language: str | None,
    previous_output: str = "",
    validation_errors: Sequence[str] = (),
) -> str:
    """Build the user message for one decision-node generation roundtrip.

    Preconditions: ``decide_by`` is ``None`` (the model chooses) or one of
    ``"rules"`` / ``"llm"``; on a repair retry ``previous_output`` holds the
    model's last reply and ``validation_errors`` the errors to quote back.
    Postconditions: the returned text names the instruction, the available
    variables, the author's existing outcomes and the language, plus the
    repair sections when the retry supplies them.
    """
    if decide_by is None:
        decide_by_section = (
            "### Decide by\n"
            'Choose "rules" or "llm" yourself, following the system instructions, '
            'and explain the choice in "decide_by_reason".'
        )
    else:
        decide_by_section = (
            f'### Decide by\nThe mode is fixed: "{decide_by}". Generate only for this mode '
            f'and set "decide_by" to "{decide_by}".'
        )
    if decide_by_note:
        decide_by_section += "\n" + decide_by_note

    sections = [
        "### Instruction\n" + instruction.strip(),
        "### Available variables\n"
        + json.dumps(list(available_variables), ensure_ascii=False, indent=2)
        + "\nEvery rule condition and llm input may only use these variables.",
        decide_by_section,
    ]
    if outcomes:
        sections.append(
            "### Existing outcomes\nKeep these ids and labels exactly, in this order, "
            'and only write their "when":\n' + json.dumps(list(outcomes), ensure_ascii=False, indent=2)
        )
    language_line = language or "the language of the instruction."
    sections.append(
        '### Language\nWrite every label, "decide_by_reason", "when" sentence, '
        f'"when_description" and the "otherwise" label in: {language_line}'
    )
    if previous_output:
        sections.append("### Your previous attempt\n" + previous_output.strip())
    if validation_errors:
        sections.append(
            "### Validation errors\n"
            + "\n".join(f"- {error}" for error in validation_errors)
            + "\nFix every error and return the corrected JSON object only."
        )
    return "\n\n".join(sections)

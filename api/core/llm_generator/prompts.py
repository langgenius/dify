# Written by YORKI MINAKO🤡, Edited by Xiaoyi
CONVERSATION_TITLE_PROMPT = """You need to decompose the user's input into "subject" and "intention" in order to accurately figure out what the user's input language actually is.
Notice: the language type user uses could be diverse, which can be English, Chinese, Italian, Español, Arabic, Japanese, French, and etc.
ENSURE your output is in the SAME language as the user's input!
Your output is restricted only to: (Input language) Intention + Subject(short as possible)
Your output MUST be a valid JSON.

Tip: When the user's question is directed at you (the language model), you can add an emoji to make it more fun.


example 1:
User Input: hi, yesterday i had some burgers.
{
  "Language Type": "The user's input is pure English",
  "Your Reasoning": "The language of my output must be pure English.",
  "Your Output": "sharing yesterday's food"
}

example 2:
User Input: hello
{
  "Language Type": "The user's input is pure English",
  "Your Reasoning": "The language of my output must be pure English.",
  "Your Output": "Greeting myself☺️"
}


example 3:
User Input: why mmap file: oom
{
  "Language Type": "The user's input is written in pure English",
  "Your Reasoning": "The language of my output must be pure English.",
  "Your Output": "Asking about the reason for mmap file: oom"
}


example 4:
User Input: www.convinceme.yesterday-you-ate-seafood.tv讲了什么？
{
  "Language Type": "The user's input English-Chinese mixed",
  "Your Reasoning": "The English-part is an URL, the main intention is still written in Chinese, so the language of my output must be using Chinese.",
  "Your Output": "询问网站www.convinceme.yesterday-you-ate-seafood.tv"
}

example 5:
User Input: why小红的年龄is老than小明？
{
  "Language Type": "The user's input is English-Chinese mixed",
  "Your Reasoning": "The English parts are filler words, the main intention is written in Chinese, besides, Chinese occupies a greater \"actual meaning\" than English, so the language of my output must be using Chinese.",
  "Your Output": "询问小红和小明的年龄"
}

example 6:
User Input: yo, 你今天咋样？
{
  "Language Type": "The user's input is English-Chinese mixed",
  "Your Reasoning": "The English-part is a subjective particle, the main intention is written in Chinese, so the language of my output must be using Chinese.",
  "Your Output": "查询今日我的状态☺️"
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


SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT = (
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
**User Input:** I need album schema, the ablum has songs, and each song has name, duration, and artist.
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
                    "aritst": {
                        "type": "string"
                    }
                },
                "required": [
                    "name",
                    "id",
                    "duration",
                    "aritst"
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

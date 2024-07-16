# Written by YORKI MINAKO🤡, Edited by Xiaoyi
CONVERSATION_TITLE_PROMPT = """You need to decompose the user's input into "subject" and "intention" in order to accurately figure out what the user's input language actually is. 
Notice: the language type user use could be diverse, which can be English, Chinese, Español, Arabic, Japanese, French, and etc.
MAKE SURE your output is the SAME language as the user's input!
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
  "Language Type": "The user's input is written in pure English",
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
  "Your Reasoning": "The English parts are subjective particles, the main intention is written in Chinese, besides, Chinese occupies a greater \"actual meaning\" than English, so the language of my output must be using Chinese.",
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
"""

SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT = (
    "Please help me predict the three most likely questions that human would ask, "
    "and keeping each question under 20 characters.\n"
    "The output must be an array in JSON format following the specified schema:\n"
    "[\"question1\",\"question2\",\"question3\"]\n"
)

GENERATOR_QA_PROMPT = (
    '<Task> The user will send a long text. Generate a Question and Answer pairs only using the knowledge in the long text. Please think step by step.'
    'Step 1: Understand and summarize the main content of this text.\n'
    'Step 2: What key information or concepts are mentioned in this text?\n'
    'Step 3: Decompose or combine multiple pieces of information and concepts.\n'
    'Step 4: Generate questions and answers based on these key information and concepts.\n'
    '<Constraints> The questions should be clear and detailed, and the answers should be detailed and complete. '
    'You must answer in {language}, in a style that is clear and detailed in {language}. No language other than {language} should be used. \n'
    '<Format> Use the following format: Q1:\nA1:\nQ2:\nA2:...\n'
    '<QA Pairs>'
)

RULE_CONFIG_GENERATE_TEMPLATE = """
Here's a task description for which I'd like you to create a high-quality prompt template:
<task_description>
{{TASK_DESCRIPTION}}
</task_description>
Based on the task description, create a well-formed json template that other ais can use to continuously complete the task. The prompt template should contain:
-"prompt" field to give other AI or LLMS a hint to do the task
- "variables" field, some tasks may require user input parameters, then please provide these fields as a list, e.g. ["Input_language", "Target_language"]
- Explicit instructions for AI to use this prompt in the "prompt" field, stating that it should step-wise explain how the input variable is used to complete the task
- The "opening_statement" field, which is the LLM opening statement and should be present in the provided 'variables' field if any
- Be consistent with the task description language.
- The output is json and contains prompt, variables, opening_statement
Please generate the full prompt template and output only the prompt template.
"""

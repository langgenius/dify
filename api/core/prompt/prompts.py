# Written by YORKI MINAKO🤡
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

CONVERSATION_SUMMARY_PROMPT = (
    "Please generate a short summary of the following conversation.\n"
    "If the following conversation communicating in English, you should only return an English summary.\n"
    "If the following conversation communicating in Chinese, you should only return a Chinese summary.\n"
    "[Conversation Start]\n"
    "{{context}}\n"
    "[Conversation End]\n\n"
    "summary:"
)

INTRODUCTION_GENERATE_PROMPT = (
    "I am designing a product for users to interact with an AI through dialogue. "
    "The Prompt given to the AI before the conversation is:\n\n"
    "```\n{prompt}\n```\n\n"
    "Please generate a brief introduction of no more than 50 words that greets the user, based on this Prompt. "
    "Do not reveal the developer's motivation or deep logic behind the Prompt, "
    "but focus on building a relationship with the user:\n"
)

MORE_LIKE_THIS_GENERATE_PROMPT = (
    "-----\n"
    "{original_completion}\n"
    "-----\n\n"
    "Please use the above content as a sample for generating the result, "
    "and include key information points related to the original sample in the result. "
    "Try to rephrase this information in different ways and predict according to the rules below.\n\n"
    "-----\n"
    "{prompt}\n"
)

SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT = (
    "Please help me predict the three most likely questions that human would ask, "
    "and keeping each question under 20 characters.\n"
    "The output must be an array in JSON format following the specified schema:\n"
    "[\"question1\",\"question2\",\"question3\"]\n"
)

GENERATOR_QA_PROMPT = (
    'The user will send a long text. Please think step by step.'
    'Step 1: Understand and summarize the main content of this text.\n'
    'Step 2: What key information or concepts are mentioned in this text?\n'
    'Step 3: Decompose or combine multiple pieces of information and concepts.\n'
    'Step 4: Generate 20 questions and answers based on these key information and concepts.'
    'The questions should be clear and detailed, and the answers should be detailed and complete.\n'
    "Answer according to the the language:{language} and in the following format: Q1:\nA1:\nQ2:\nA2:...\n"
)

RULE_CONFIG_GENERATE_TEMPLATE = """Given MY INTENDED AUDIENCES and HOPING TO SOLVE using a language model, please select \
the model prompt that best suits the input. 
You will be provided with the prompt, variables, and an opening statement. 
Only the content enclosed in double curly braces, such as {{variable}}, in the prompt can be considered as a variable; \
otherwise, it cannot exist as a variable in the variables.
If you believe revising the original input will result in a better response from the language model, you may \
suggest revisions.

<< FORMATTING >>
Return a markdown code snippet with a JSON object formatted to look like, \
no any other string out of markdown code snippet:
```json
{{{{
    "prompt": string \\ generated prompt
    "variables": list of string \\ variables
    "opening_statement": string \\ an opening statement to guide users on how to ask questions with generated prompt \
and fill in variables, with a welcome sentence, and keep TLDR.
}}}}
```

<< EXAMPLES >>
[EXAMPLE A]
```json
{
  "prompt": "Write a letter about love",
  "variables": [],
  "opening_statement": "Hi! I'm your love letter writer AI."
}
```

[EXAMPLE B]
```json
{
  "prompt": "Translate from {{lanA}} to {{lanB}}",
  "variables": ["lanA", "lanB"],
  "opening_statement": "Welcome to use translate app"
}
```

[EXAMPLE C]
```json
{
  "prompt": "Write a story about {{topic}}",
  "variables": ["topic"],
  "opening_statement": "I'm your story writer"
}
```

<< MY INTENDED AUDIENCES >>
{{audiences}}

<< HOPING TO SOLVE >>
{{hoping_to_solve}}

<< OUTPUT >>
"""
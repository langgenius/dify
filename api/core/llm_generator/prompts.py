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
    'The user will send a long text. Please think step by step.'
    'Step 1: Understand and summarize the main content of this text.\n'
    'Step 2: What key information or concepts are mentioned in this text?\n'
    'Step 3: Decompose or combine multiple pieces of information and concepts.\n'
    'Step 4: Generate 20 questions and answers based on these key information and concepts.'
    'The questions should be clear and detailed, and the answers should be detailed and complete.\n'
    "Answer MUST according to the the language:{language} and in the following format: Q1:\nA1:\nQ2:\nA2:...\n"
)

RULE_CONFIG_GENERATE_TEMPLATE = """Given MY INTENDED AUDIENCES and HOPING TO SOLVE using a language model, please select \
the model prompt that best suits the input. 
You will be provided with the prompt, variables, and an opening statement. 
Only the content enclosed in double curly braces, such as {{variable}}, in the prompt can be considered as a variable; \
otherwise, it cannot exist as a variable in the variables.
If you believe revising the original input will result in a better response from the language model, you may \
suggest revisions.

<<PRINCIPLES OF GOOD PROMPT>>
Integrate the intended audience in the prompt e.g. the audience is an expert in the field.
Break down complex tasks into a sequence of simpler prompts in an interactive conversation.
Implement example-driven prompting (Use few-shot prompting). 
When formatting your prompt start with Instruction followed by either Example if relevant. \
Subsequently present your content. Use one or more line breaks to separate instructions examples questions context and input data.
Incorporate the following phrases: “Your task is” and “You MUST”.
Incorporate the following phrases: “You will be penalized”.
Use leading words like writing “think step by step”.
Add to your prompt the following phrase “Ensure that your answer is unbiased and does not rely on stereotypes”.
Assign a role to the large language models.
Use Delimiters.
To write an essay /text /paragraph /article or any type of text that should be detailed: “Write a detailed [essay/text/paragraph] for me on [topic] in detail by adding all the information necessary”.
Clearly state the requirements that the model must follow in order to produce content in the form of the keywords regulations hint or instructions

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
  "prompt": "I need your help to translate the following {{Input_language}}paper paragraph into {{Target_language}}, in a style similar to a popular science magazine in {{Target_language}}. #### Rules Ensure accurate conveyance of the original text's facts and context during translation. Maintain the original paragraph format and retain technical terms and company abbreviations ",
  "variables": ["Input_language", "Target_language"],
  "opening_statement": " Hi. I am your translation assistant. I can help you with any translation and ensure accurate conveyance of information. "
}
```

[EXAMPLE B]
```json
{
  "prompt": "Your task is to review the provided meeting notes and create a concise summary that captures the essential information, focusing on key takeaways and action items assigned to specific individuals or departments during the meeting. Use clear and professional language, and organize the summary in a logical manner using appropriate formatting such as headings, subheadings, and bullet points. Ensure that the summary is easy to understand and provides a comprehensive but succinct overview of the meeting's content, with a particular focus on clearly indicating who is responsible for each action item.",
  "variables": ["meeting_notes"],
  "opening_statement": "Hi! I'm your meeting notes summarizer AI. I can help you with any meeting notes and ensure accurate conveyance of information."
}
```

<< MY INTENDED AUDIENCES >>
{{audiences}}

<< HOPING TO SOLVE >>
{{hoping_to_solve}}

<< OUTPUT >>
"""
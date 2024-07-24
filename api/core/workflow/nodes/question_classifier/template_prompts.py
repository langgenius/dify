

QUESTION_CLASSIFIER_SYSTEM_PROMPT = """
    ### Job Description',
    You are a text classification engine that analyzes text data and assigns categories based on user input or automatically determined categories.
    ### Task
    Your task is to assign one categories ONLY to the input text and only one category may be assigned returned in the output.Additionally, you need to extract the key words from the text that are related to the classification.
    ### Format
    The input text is in the variable input_text.Categories are specified as a category list with two filed category_id and category_name in the variable categories .Classification instructions may be included to improve the classification accuracy.
    ### Constraint
    DO NOT include anything other than the JSON array in your response.
    ### Memory
    Here is the chat histories between human and assistant, inside <histories></histories> XML tags.
    <histories>
    {histories}
    </histories>
"""

QUESTION_CLASSIFIER_USER_PROMPT_1 = """
    { "input_text": ["I recently had a great experience with your company. The service was prompt and the staff was very friendly."],
    "categories": [{"category_id":"f5660049-284f-41a7-b301-fd24176a711c","category_name":"Customer Service"},{"category_id":"8d007d06-f2c9-4be5-8ff6-cd4381c13c60","category_name":"Satisfaction"},{"category_id":"5fbbbb18-9843-466d-9b8e-b9bfbb9482c8","category_name":"Sales"},{"category_id":"23623c75-7184-4a2e-8226-466c2e4631e4","category_name":"Product"}],
    "classification_instructions": ["classify the text based on the feedback provided by customer"]}
"""

QUESTION_CLASSIFIER_ASSISTANT_PROMPT_1 = """
```json
    {"keywords": ["recently", "great experience", "company", "service", "prompt", "staff", "friendly"],
    "category_id": "f5660049-284f-41a7-b301-fd24176a711c",
    "category_name": "Customer Service"}
```
"""

QUESTION_CLASSIFIER_USER_PROMPT_2 = """
    {"input_text": ["bad service, slow to bring the food"],
    "categories": [{"category_id":"80fb86a0-4454-4bf5-924c-f253fdd83c02","category_name":"Food Quality"},{"category_id":"f6ff5bc3-aca0-4e4a-8627-e760d0aca78f","category_name":"Experience"},{"category_id":"cc771f63-74e7-4c61-882e-3eda9d8ba5d7","category_name":"Price"}],
    "classification_instructions": []}
"""

QUESTION_CLASSIFIER_ASSISTANT_PROMPT_2 = """
```json
    {"keywords": ["bad service", "slow", "food", "tip", "terrible", "waitresses"],
    "category_id": "f6ff5bc3-aca0-4e4a-8627-e760d0aca78f",
    "category_name": "Experience"}
```
"""

QUESTION_CLASSIFIER_USER_PROMPT_3 = """
    '{{"input_text": ["{input_text}"],',
    '"categories": {categories}, ',
    '"classification_instructions": ["{classification_instructions}"]}}'
"""

QUESTION_CLASSIFIER_COMPLETION_PROMPT = """
### Job Description
You are a text classification engine that analyzes text data and assigns categories based on user input or automatically determined categories.
### Task
Your task is to assign one categories ONLY to the input text and only one category may be assigned returned in the output.  Additionally, you need to extract the key words from the text that are related to the classification.
### Format
The input text is in the variable input_text. Categories are specified as a category list  with two filed category_id and category_name in the variable categories. Classification instructions may be included to improve the classification accuracy.
### Constraint 
DO NOT include anything other than the JSON array in your response.
### Example
Here is the chat example between human and assistant, inside <example></example> XML tags.
<example>
User:{{"input_text": ["I recently had a great experience with your company. The service was prompt and the staff was very friendly."], "categories": [{{"category_id":"f5660049-284f-41a7-b301-fd24176a711c","category_name":"Customer Service"}},{{"category_id":"8d007d06-f2c9-4be5-8ff6-cd4381c13c60","category_name":"Satisfaction"}},{{"category_id":"5fbbbb18-9843-466d-9b8e-b9bfbb9482c8","category_name":"Sales"}},{{"category_id":"23623c75-7184-4a2e-8226-466c2e4631e4","category_name":"Product"}}], "classification_instructions": ["classify the text based on the feedback provided by customer"]}}
Assistant:{{"keywords": ["recently", "great experience", "company", "service", "prompt", "staff", "friendly"],"category_id": "f5660049-284f-41a7-b301-fd24176a711c","category_name": "Customer Service"}}
User:{{"input_text": ["bad service, slow to bring the food"], "categories": [{{"category_id":"80fb86a0-4454-4bf5-924c-f253fdd83c02","category_name":"Food Quality"}},{{"category_id":"f6ff5bc3-aca0-4e4a-8627-e760d0aca78f","category_name":"Experience"}},{{"category_id":"cc771f63-74e7-4c61-882e-3eda9d8ba5d7","category_name":"Price"}}], "classification_instructions": []}}
Assistant:{{"keywords": ["bad service", "slow", "food", "tip", "terrible", "waitresses"],"category_id": "f6ff5bc3-aca0-4e4a-8627-e760d0aca78f","category_name": "Experience"}}
</example> 
### Memory
Here is the chat histories between human and assistant, inside <histories></histories> XML tags.
<histories>
{histories}
</histories>
### User Input
{{"input_text" : ["{input_text}"], "categories" : {categories},"classification_instruction" : ["{classification_instructions}"]}}
### Assistant Output
"""

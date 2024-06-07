import os
import openai
from dotenv import load_dotenv

load_dotenv()

azure_openai_endpoint = os.environ.get("AZURE_OPENAI_TEST_ENDPOINT")
azure_openai_key = os.environ.get("AZURE_OPENAI_TEST_KEY")

# openai_api_key = os.environ.get("OPENAI_API_TEST_KEY")
client = openai.AzureOpenAI(
    api_key=azure_openai_key,
    api_version="2024-02-15-preview",
    azure_endpoint=azure_openai_endpoint,
)

# completion = client.chat.completions.create(
#     model="gpt-4o",
#     messages=[
#         {
#             "role": "user",
#             "content": "The Transformer model was introduced in the paper \"Attention is All You Need\" by;",
#         },
#     ],
# )

# print(completion.to_json())

with open('instruction.md', 'r') as file:
    instructions = file.read()
    # print(instructions)
    assistant = client.beta.assistants.create(
        instructions=instructions,
        model="gpt-4o",  # "gpt-4o",  # replace with model deployment name.
        tools=[{"type": "code_interpreter"}]
    )
    # print(assistant.to_json())

print(client.beta.assistants.list())

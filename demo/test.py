import os
import openai
from openai import AssistantEventHandler
from tools import TOOL_MAP
from typing_extensions import override
from dotenv import load_dotenv

load_dotenv()

azure_openai_endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")
azure_openai_key = os.environ.get("AZURE_OPENAI_KEY")

openai_api_key = os.environ.get("OPENAI_API_KEY")
client = openai.AzureOpenAI(
    api_key=azure_openai_key,
    api_version="2024-02-15-preview",
    azure_endpoint=azure_openai_endpoint,
)
with open('instruction.md', 'r') as file:
    instructions = file.read()
    assistant = client.beta.assistants.create(
        instructions=instructions,
        model="gpt-4o",  # replace with model deployment name.
        tools=[{"type": "code_interpreter"}]
    )

print(client.beta.assistants.list())

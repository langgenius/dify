import os
from openai import AzureOpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from dotenv import load_dotenv

load_dotenv()

endpoint = os.environ["AZURE_OPENAI_TEST_ENDPOINT"]
deployment = os.environ["CHAT_COMPLETIONS_DEPLOYMENT_NAME"]
search_endpoint = os.environ["AZURE_AI_SEARCH_ENDPOINT"]
search_index = os.environ["AZURE_AI_SEARCH_INDEX"]
azure_openai_key = os.environ.get("AZURE_OPENAI_TEST_KEY")

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default")

client = AzureOpenAI(
    api_key=azure_openai_key,
    azure_endpoint=endpoint,
    # azure_ad_token_provider=token_provider,
    api_version="2024-02-01",
)

completion = client.chat.completions.create(
    model=deployment,
    messages=[
        {
            "role": "user",
            "content": "The Transformer model was introduced in the paper \"Attention is All You Need\" by;",
        },
    ],
    extra_body={
        "data_sources": [
            {
                "type": "azure_search",
                "parameters": {
                    "endpoint": search_endpoint,
                    "index_name": search_index,
                    "authentication": {
                        "type": "system_assigned_managed_identity"
                    }
                }
            }
        ]
    }
)

print(completion.to_json())

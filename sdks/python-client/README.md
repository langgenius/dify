# dify-client

A Dify App Service-API Client, using for build a webapp by request Service-API

## Usage

First, install `dify-client` python sdk package:

```
pip install dify-client
```

### Synchronous Usage

Write your code with sdk:

- completion generate with `blocking` response_mode

```python
from dify_client import CompletionClient

api_key = "your_api_key"

# Initialize CompletionClient
completion_client = CompletionClient(api_key)

# Create Completion Message using CompletionClient
completion_response = completion_client.create_completion_message(inputs={"query": "What's the weather like today?"},
                                                                  response_mode="blocking", user="user_id")
completion_response.raise_for_status()

result = completion_response.json()

print(result.get('answer'))
```

- completion using vision model, like gpt-4-vision

```python
from dify_client import CompletionClient

api_key = "your_api_key"

# Initialize CompletionClient
completion_client = CompletionClient(api_key)

files = [{
    "type": "image",
    "transfer_method": "remote_url",
    "url": "your_image_url"
}]

# files = [{
#     "type": "image",
#     "transfer_method": "local_file",
#     "upload_file_id": "your_file_id"
# }]

# Create Completion Message using CompletionClient
completion_response = completion_client.create_completion_message(inputs={"query": "Describe the picture."},
                                                                  response_mode="blocking", user="user_id", files=files)
completion_response.raise_for_status()

result = completion_response.json()

print(result.get('answer'))
```

- chat generate with `streaming` response_mode

```python
import json
from dify_client import ChatClient

api_key = "your_api_key"

# Initialize ChatClient
chat_client = ChatClient(api_key)

# Create Chat Message using ChatClient
chat_response = chat_client.create_chat_message(inputs={}, query="Hello", user="user_id", response_mode="streaming")
chat_response.raise_for_status()

for line in chat_response.iter_lines(decode_unicode=True):
    line = line.split('data:', 1)[-1]
    if line.strip():
        line = json.loads(line.strip())
        print(line.get('answer'))
```

- chat using vision model, like gpt-4-vision

```python
from dify_client import ChatClient

api_key = "your_api_key"

# Initialize ChatClient
chat_client = ChatClient(api_key)

files = [{
    "type": "image",
    "transfer_method": "remote_url",
    "url": "your_image_url"
}]

# files = [{
#     "type": "image",
#     "transfer_method": "local_file",
#     "upload_file_id": "your_file_id"
# }]

# Create Chat Message using ChatClient
chat_response = chat_client.create_chat_message(inputs={}, query="Describe the picture.", user="user_id",
                                                response_mode="blocking", files=files)
chat_response.raise_for_status()

result = chat_response.json()

print(result.get("answer"))
```

- upload file when using vision model

```python
from dify_client import DifyClient

api_key = "your_api_key"

# Initialize Client
dify_client = DifyClient(api_key)

file_path = "your_image_file_path"
file_name = "panda.jpeg"
mime_type = "image/jpeg"

with open(file_path, "rb") as file:
    files = {
        "file": (file_name, file, mime_type)
    }
    response = dify_client.file_upload("user_id", files)

    result = response.json()
    print(f'upload_file_id: {result.get("id")}')
```

- Others

```python
from dify_client import ChatClient

api_key = "your_api_key"

# Initialize Client
client = ChatClient(api_key)

# Get App parameters
parameters = client.get_application_parameters(user="user_id")
parameters.raise_for_status()

print('[parameters]')
print(parameters.json())

# Get Conversation List (only for chat)
conversations = client.get_conversations(user="user_id")
conversations.raise_for_status()

print('[conversations]')
print(conversations.json())

# Get Message List (only for chat)
messages = client.get_conversation_messages(user="user_id", conversation_id="conversation_id")
messages.raise_for_status()

print('[messages]')
print(messages.json())

# Rename Conversation (only for chat)
rename_conversation_response = client.rename_conversation(conversation_id="conversation_id",
                                                          name="new_name", user="user_id")
rename_conversation_response.raise_for_status()

print('[rename result]')
print(rename_conversation_response.json())
```

- Using the Workflow Client

```python
import json 
import requests
from dify_client import WorkflowClient

api_key = "your_api_key"

# Initialize Workflow Client
client = WorkflowClient(api_key)

# Prepare parameters for Workflow Client
user_id = "your_user_id"
context = "previous user interaction / metadata"
user_prompt = "What is the capital of France?"

inputs = {
    "context": context, 
    "user_prompt": user_prompt,
    # Add other input fields expected by your workflow (e.g., additional context, task parameters)

}

# Set response mode (default: streaming)
response_mode = "blocking"

# Run the workflow
response = client.run(inputs=inputs, response_mode=response_mode, user=user_id)
response.raise_for_status()

# Parse result
result = json.loads(response.text)

answer = result.get("data").get("outputs")

print(answer["answer"])

```

- Dataset Management

```python
from dify_client import KnowledgeBaseClient

api_key = "your_api_key"
dataset_id = "your_dataset_id"

# Use context manager to ensure proper resource cleanup
with KnowledgeBaseClient(api_key, dataset_id) as kb_client:
    # Get dataset information
    dataset_info = kb_client.get_dataset()
    dataset_info.raise_for_status()
    print(dataset_info.json())

    # Update dataset configuration
    update_response = kb_client.update_dataset(
        name="Updated Dataset Name",
        description="Updated description",
        indexing_technique="high_quality"
    )
    update_response.raise_for_status()
    print(update_response.json())

    # Batch update document status
    batch_response = kb_client.batch_update_document_status(
        action="enable",
        document_ids=["doc_id_1", "doc_id_2", "doc_id_3"]
    )
    batch_response.raise_for_status()
    print(batch_response.json())
```

- Conversation Variables Management

```python
from dify_client import ChatClient

api_key = "your_api_key"

# Use context manager to ensure proper resource cleanup
with ChatClient(api_key) as chat_client:
    # Get all conversation variables
    variables = chat_client.get_conversation_variables(
        conversation_id="conversation_id",
        user="user_id"
    )
    variables.raise_for_status()
    print(variables.json())

    # Update a specific conversation variable
    update_var = chat_client.update_conversation_variable(
        conversation_id="conversation_id",
        variable_id="variable_id",
        value="new_value",
        user="user_id"
    )
    update_var.raise_for_status()
    print(update_var.json())
```

### Asynchronous Usage

The SDK provides full async/await support for all API operations using `httpx.AsyncClient`. All async clients mirror their synchronous counterparts but require `await` for method calls.

- async chat with `blocking` response_mode

```python
import asyncio
from dify_client import AsyncChatClient

api_key = "your_api_key"

async def main():
    # Use async context manager for proper resource cleanup
    async with AsyncChatClient(api_key) as client:
        response = await client.create_chat_message(
            inputs={},
            query="Hello, how are you?",
            user="user_id",
            response_mode="blocking"
        )
        response.raise_for_status()
        result = response.json()
        print(result.get('answer'))

# Run the async function
asyncio.run(main())
```

- async completion with `streaming` response_mode

```python
import asyncio
import json
from dify_client import AsyncCompletionClient

api_key = "your_api_key"

async def main():
    async with AsyncCompletionClient(api_key) as client:
        response = await client.create_completion_message(
            inputs={"query": "What's the weather?"},
            response_mode="streaming",
            user="user_id"
        )
        response.raise_for_status()

        # Stream the response
        async for line in response.aiter_lines():
            if line.startswith('data:'):
                data = line[5:].strip()
                if data:
                    chunk = json.loads(data)
                    print(chunk.get('answer', ''), end='', flush=True)

asyncio.run(main())
```

- async workflow execution

```python
import asyncio
from dify_client import AsyncWorkflowClient

api_key = "your_api_key"

async def main():
    async with AsyncWorkflowClient(api_key) as client:
        response = await client.run(
            inputs={"query": "What is machine learning?"},
            response_mode="blocking",
            user="user_id"
        )
        response.raise_for_status()
        result = response.json()
        print(result.get("data").get("outputs"))

asyncio.run(main())
```

- async dataset management

```python
import asyncio
from dify_client import AsyncKnowledgeBaseClient

api_key = "your_api_key"
dataset_id = "your_dataset_id"

async def main():
    async with AsyncKnowledgeBaseClient(api_key, dataset_id) as kb_client:
        # Get dataset information
        dataset_info = await kb_client.get_dataset()
        dataset_info.raise_for_status()
        print(dataset_info.json())

        # List documents
        docs = await kb_client.list_documents(page=1, page_size=10)
        docs.raise_for_status()
        print(docs.json())

asyncio.run(main())
```

**Benefits of Async Usage:**

- **Better Performance**: Handle multiple concurrent API requests efficiently
- **Non-blocking I/O**: Don't block the event loop during network operations
- **Scalability**: Ideal for applications handling many simultaneous requests
- **Modern Python**: Leverages Python's native async/await syntax

**Available Async Clients:**

- `AsyncDifyClient` - Base async client
- `AsyncChatClient` - Async chat operations
- `AsyncCompletionClient` - Async completion operations
- `AsyncWorkflowClient` - Async workflow operations
- `AsyncKnowledgeBaseClient` - Async dataset/knowledge base operations
- `AsyncWorkspaceClient` - Async workspace operations

```
```

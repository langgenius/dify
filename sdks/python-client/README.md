# dify-client

A Dify App Service-API Client, using for build a webapp by request Service-API

## Usage

First, install `dify-client` python sdk package:

```
pip install dify-client
```

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

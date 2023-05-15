# dify-client

A Dify App Service-API Client, using for build a webapp by request Service-API

## Usage

First, install `dify-client` python sdk package:

```
pip install dify-client
```

Write your code with sdk:

- completion generate with `blocking` response_mode

```
import json
from dify_client import CompletionClient

api_key = "your_api_key"

# Initialize CompletionClient
completion_client = CompletionClient(api_key)

# Create Completion Message using CompletionClient
completion_response = completion_client.create_completion_message(inputs={}, query="Hello", response_mode="blocking", user="user_id")
completion_response.raise_for_status()

result = completion_response.text
result = json.loads(result)

print(result.get('answer'))
```

- chat generate with `streaming` response_mode

```
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

- Others

```
import json
from dify_client import ChatClient

api_key = "your_api_key"

# Initialize Client
client = ChatClient(api_key)

# Get App parameters
parameters = client.get_application_parameters(user="user_id")
parameters.raise_for_status()
parameters = json.loads(parameters.text)

print('[parameters]')
print(parameters)

# Get Conversation List (only for chat)
conversations = client.get_conversations(user="user_id")
conversations.raise_for_status()
conversations = json.loads(conversations.text)

print('[conversations]')
print(conversations)

# Get Message List (only for chat)
messages = client.get_conversation_messages(user="user_id", conversation_id="conversation_id")
messages.raise_for_status()
messages = json.loads(messages.text)

print('[messages]')
print(messages)

# Rename Conversation (only for chat)
rename_conversation_response = client.rename_conversation(conversation_id="conversation_id", name="new_name", user="user_id")
rename_conversation_response.raise_for_status()
rename_conversation_result = json.loads(rename_conversation_response.text)

print('[rename result]')
print(rename_conversation_result)
```

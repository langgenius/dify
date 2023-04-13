# langgenius-client
A LangGenius App Service-API Client, using for build a webapp by request Service-API

## Usage

First, install `langgenius-client` python sdk package:

```
pip install langgenius-client
```

Write your code with sdk:

```
api_key = "your_api_key"

# Initialize CompletionClient
completion_client = CompletionClient(api_key)

# Create Completion Message using CompletionClient
completion_response = completion_client.create_completion_message(inputs={}, query="Hello", response_mode="blocking", user="user_id")
print(completion_response)

# Initialize ChatClient
chat_client = ChatClient(api_key)

# Create Chat Message using ChatClient
chat_response = chat_client.create_chat_message(inputs={}, message="Hello", user="user_id", response_mode="streaming")
print(chat_response)

# Get Chat History using ChatClient
chat_history = chat_client.get_chat_history(user="user_id")
print(chat_history)

# Get Conversation List using ChatClient
conversations = chat_client.list_conversations(user="user_id")
print(conversations)

# Rename Conversation using ChatClient
rename_conversation_response = chat_client.rename_conversation(conversation_id="conversation_id", name="new_name", user="user_id")
print(rename_conversation_response)
```

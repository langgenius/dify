# Dify Node.js SDK
This is the Node.js SDK for the Dify API, which allows you to easily integrate Dify into your Node.js applications.

## Install
```bash
npm install dify-client
```

## Usage
After installing the SDK, you can use it in your project like this:

```js
import { DifyClient, ChatClient, CompletionClient } from 'dify-client'

const API_KEY = 'your-api-key-here';
const user = `random-user-id`;

// Create a completion client
const completionClient = new CompletionClient(API_KEY)
// Create a completion message
completionClient.createCompletionMessage(inputs, query, responseMode, user)

// Create a chat client
const chatClient = new ChatClient(API_KEY)
// Create a chat message
chatClient.createChatMessage(inputs, query, responseMode, user, conversationId)
// Fetch conversations
chatClient.getConversations(user)
// Fetch conversation messages
chatClient.getConversationMessages(conversationId, user)
// Rename conversation
chatClient.renameConversation(conversationId, name, user)


const client = new DifyClient(API_KEY)
// Fetch application parameters
client.getApplicationParameters(user)
// Provide feedback for a message
client.messageFeedback(messageId, rating, user)

```

Replace 'your-api-key-here' with your actual Dify API key.Replace 'your-app-id-here' with your actual Dify APP ID.

## License
This SDK is released under the MIT License.

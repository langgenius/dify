# LangGenius Node.js SDK
This is the Node.js SDK for the LangGenius API, which allows you to easily integrate LangGenius into your Node.js applications.

## Install
```bash
npm install langgenius-client
```

## Usage
After installing the SDK, you can use it in your project like this:

```js
import { LangGeniusClient, ChatClient, CompletionClient } from 'langgenius-client'

const API_KEY = 'your-api-key-here';
const APP_ID = 'your-app-id-here';
const user = `user_${APP_ID}:user_id`:

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


const langGeniusClient = new LangGeniusClient(API_KEY)
// Fetch application parameters
langGeniusClient.getApplicationParameters(user)
// Provide feedback for a message
langGeniusClient.messageFeedback(messageId, rating, user)

```

Replace 'your-api-key-here' with your actual LangGenius API key.Replace 'your-app-id-here' with your actual LangGenius APP ID.

## License
This SDK is released under the MIT License.
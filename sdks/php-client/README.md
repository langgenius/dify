# LangGenius PHP SDK

This is the PHP SDK for the LangGenius API, which allows you to easily integrate LangGenius into your PHP applications.

## Requirements

- PHP 7.2 or later
- Guzzle HTTP client library

## Usage

After installing the SDK, you can use it in your project like this:

```
<?php

require 'vendor/autoload.php';

use YourVendorName\LangGeniusPHP\LangGeniusClient;
use YourVendorName\LangGeniusPHP\CompletionClient;
use YourVendorName\LangGeniusPHP\ChatClient;

$apiKey = 'your-api-key-here';

$langGeniusClient = new LangGeniusClient($apiKey);

// Create a completion client
$completionClient = new CompletionClient($apiKey);
$response = $completionClient->create_completion_message($inputs, $query, $response_mode, $user);

// Create a chat client
$chatClient = new ChatClient($apiKey);
$response = $chatClient->create_chat_message($inputs, $query, $user, $response_mode, $conversation_id);

// Fetch application parameters
$response = $langGeniusClient->get_application_parameters($user);

// Provide feedback for a message
$response = $langGeniusClient->message_feedback($message_id, $rating, $user);

// Other available methods:
// - get_conversation_messages()
// - get_conversations()
// - rename_conversation()
```

Replace 'your-api-key-here' with your actual LangGenius API key.

## License

This SDK is released under the MIT License.
# Dify PHP SDK

This is the PHP SDK for the Dify API, which allows you to easily integrate Dify into your PHP applications.

## Requirements

- PHP 7.2 or later
- Guzzle HTTP client library

## Usage

After installing the SDK, you can use it in your project like this:

```php
<?php

require 'vendor/autoload.php';

use YourVendorName\DifyPHP\DifyClient;
use YourVendorName\DifyPHP\CompletionClient;
use YourVendorName\DifyPHP\ChatClient;

$apiKey = 'your-api-key-here';

$difyClient = new DifyClient($apiKey);

// Create a completion client
$completionClient = new CompletionClient($apiKey);
$response = $completionClient->create_completion_message(array("query" => "Who are you?"), "blocking", "user_id");

// Create a chat client
$chatClient = new ChatClient($apiKey);
$response = $chatClient->create_chat_message(array(), "Who are you?", "user_id", "blocking", $conversation_id);

$fileForVision = [
    [
        "type" => "image",
        "transfer_method" => "remote_url",
        "url" => "your_image_url"
    ]
];

// $fileForVision = [
//     [
//         "type" => "image",
//         "transfer_method" => "local_file",
//         "url" => "your_file_id"
//     ]
// ];

// Create a completion client with vision model like gpt-4-vision
$response = $completionClient->create_completion_message(array("query" => "Describe this image."), "blocking", "user_id", $fileForVision);

// Create a chat client with vision model like gpt-4-vision
$response = $chatClient->create_chat_message(array(), "Describe this image.", "user_id", "blocking", $conversation_id, $fileForVision);

// File Upload
$fileForUpload = [
    [
        'tmp_name' => '/path/to/file/filename.jpg',
        'name' => 'filename.jpg'
    ]
];
$response = $difyClient->file_upload("user_id", $fileForUpload);
$result = json_decode($response->getBody(), true);
echo 'upload_file_id: ' . $result['id'];

// Fetch application parameters
$response = $difyClient->get_application_parameters("user_id");

// Provide feedback for a message
$response = $difyClient->message_feedback($message_id, $rating, "user_id");

// Other available methods:
// - get_conversation_messages()
// - get_conversations()
// - rename_conversation()
```

Replace 'your-api-key-here' with your actual Dify API key.

## License

This SDK is released under the MIT License.
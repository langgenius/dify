# Dify PHP SDK

This is the PHP SDK for the Dify API, which allows you to easily integrate Dify into your PHP applications.

## Requirements

- PHP 7.2 or later
- Guzzle HTTP client library

## Usage

If you want to try the example, you can run `composer install` in this directory.

For an existing project, copy `dify-client.php` into your project and merge the following into `composer.json`, then run `composer install` and `composer dump-autoload`. Keep the dependency requirements aligned with this directory’s `composer.json`.

```json
{
    "require": {
        "guzzlehttp/guzzle": "^7.15.2"
    },
    "autoload": {
        "files": ["path/to/dify-client.php"]
    }
}
```

After installing the SDK, you can use it in your project like this:

```php
<?php

require 'vendor/autoload.php';

$apiKey = 'your-api-key-here';
$conversation_id = null; // Start a new conversation.

$difyClient = new DifyClient($apiKey);

// Self-hosted endpoints keep their full path with or without a trailing slash.
$selfHostedClient = new DifyClient($apiKey, 'https://dify.example.com/dify/v1');

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
//         "upload_file_id" => "your_file_id"
//     ]
// ];

// Create a completion client with a vision-capable model
$response = $completionClient->create_completion_message(array("query" => "Describe this image."), "blocking", "user_id", $fileForVision);

// Create a chat client with a vision-capable model
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

## Streaming responses

Pass `streaming` as the response mode to receive a Guzzle response without waiting for
all workflow events to arrive. Read its body incrementally; individual reads may split
an SSE event across chunks.

```php
$workflowClient = new WorkflowClient($apiKey);
$response = $workflowClient->run(array("query" => "hello"), "streaming", "user_id");
$body = $response->getBody();
while (!$body->eof()) {
    echo $body->read(1024);
}
```

Use `blocking` for the complete JSON response.

For text-to-audio, pass `true` to consume audio without buffering the complete response:

```php
$response = $difyClient->text_to_audio("Hello", "user_id", true);
$body = $response->getBody();
while (!$body->eof()) {
    echo $body->read(1024);
}
```

This controls client-side buffering. Whether the server produces audio incrementally
depends on the TTS provider output.

## Empty app inputs

Apps without custom input variables can be called with an empty PHP array:

```php
$response = $chatClient->create_chat_message([], "Hello", "user_id", "blocking");
```

The SDK sends the top-level `inputs` as `{}`, as required by the API, for chat,
completion and workflow requests. Nonempty input maps and nested arrays retain
their values and JSON types.

## Conversation pagination

Pass the final conversation ID from the previous page as the second argument:

```php
$page = json_decode((string) $chatClient->get_conversations("user_id", null, 20)->getBody(), true);
if ($page['has_more'] && $page['data']) {
    $lastConversation = end($page['data']);
    $nextPage = $chatClient->get_conversations("user_id", $lastConversation['id'], 20);
}
```

For compatibility, this argument retains its legacy PHP name `$first_id`, but the
conversation-list request sends the API's `last_id` field. Message history through
`get_conversation_messages()` continues to send `first_id`.

## License

This SDK is released under the MIT License.

## Tests

After `composer install`, run these commands from this directory:

```sh
php tests/base_url_test.php
php tests/conversation_pagination_test.php
php tests/input_object_test.php
php tests/streaming_test.php
```

The regressions use Guzzle's mock transport and do not contact an API or model provider.

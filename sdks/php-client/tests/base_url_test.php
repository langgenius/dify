<?php

require dirname(__DIR__) . '/vendor/autoload.php';

use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;

$cases = [
    [null, 'https://api.dify.ai/v1/'],
    ['https://dify.example.com/v1', 'https://dify.example.com/v1/'],
    ['https://dify.example.com/v1/', 'https://dify.example.com/v1/'],
    ['https://dify.example.com/dify/v1', 'https://dify.example.com/dify/v1/'],
    ['https://dify.example.com/dify/v1/', 'https://dify.example.com/dify/v1/'],
    ['https://dify.example.com', 'https://dify.example.com/'],
    ['https://dify.example.com/', 'https://dify.example.com/'],
];

$clients = [
    ['DifyClient', 'get_application_parameters', ['test-user'], 'GET', 'parameters?user=test-user', null],
    ['ChatClient', 'stop_message', ['task-1', 'test-user'], 'POST', 'chat-messages/task-1/stop', ['user' => 'test-user']],
    ['CompletionClient', 'create_completion_message', [[], 'blocking', 'test-user'], 'POST', 'completion-messages',
        ['inputs' => [], 'response_mode' => 'blocking', 'user' => 'test-user', 'files' => null]],
    ['WorkflowClient', 'stop', ['task-1', 'test-user'], 'POST', 'workflows/tasks/task-1/stop', ['user' => 'test-user']],
];

$count = 0;
foreach ($clients as [$clientClass, $method, $args, $httpMethod, $endpoint, $payload]) {
    foreach ($cases as [$baseUrl, $expectedBase]) {
        $expectedUrl = $expectedBase . $endpoint;
        $history = [];
        $stack = HandlerStack::create(new MockHandler([new Response(200, [], '{"ok":true}')]));
        $stack->push(Middleware::history($history));
        $client = new $clientClass('test-api-key', $baseUrl);
        // Replace only Guzzle's transport; retain the real constructor and URI resolution.
        $property = new ReflectionProperty(DifyClient::class, 'client');
        if (PHP_VERSION_ID < 80100) {
            $property->setAccessible(true);
        }
        $property->getValue($client)->getConfig('handler')->setHandler($stack);

        $response = $client->$method(...$args);
        $request = $history[0]['request'];
        if ((string) $request->getUri() !== $expectedUrl) {
            throw new RuntimeException($clientClass . ': expected ' . $expectedUrl . ', got ' . $request->getUri());
        }
        if ($request->getMethod() !== $httpMethod
            || $request->getHeaderLine('Authorization') !== 'Bearer test-api-key'
            || $response->getStatusCode() !== 200) {
            throw new RuntimeException('Request or response contract changed');
        }
        if ($payload !== null && json_decode((string) $request->getBody(), true) !== $payload) {
            throw new RuntimeException('Request payload changed');
        }
        ++$count;
    }
}

echo "Base URL regression: {$count} requests passed\n";

<?php

require dirname(__DIR__) . '/vendor/autoload.php';

use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;

$clients = [
    ['ChatClient', 'create_chat_message', 'chat-messages'],
    ['CompletionClient', 'create_completion_message', 'completion-messages'],
    ['WorkflowClient', 'run', 'workflows/run'],
];
$cases = [[], ['name' => 'Ada', 'items' => ['a', 'b'], 'empty_items' => []], new stdClass()];
$count = 0;
foreach ($clients as [$clientClass, $method, $endpoint]) {
    foreach ($cases as $inputs) {
        $history = [];
        $stack = HandlerStack::create(new MockHandler([new Response(200, [], '{"ok":true}')]));
        $stack->push(Middleware::history($history));
        $client = new $clientClass('test-api-key');
        $property = new ReflectionProperty(DifyClient::class, 'client');
        if (PHP_VERSION_ID < 80100) {
            $property->setAccessible(true);
        }
        $property->getValue($client)->getConfig('handler')->setHandler($stack);
        if ($clientClass === 'ChatClient') {
            $client->$method($inputs, 'Hello', 'test-user', 'blocking');
        } else {
            $client->$method($inputs, 'blocking', 'test-user');
        }

        $request = $history[0]['request'];
        $payload = json_decode((string) $request->getBody());
        if (!is_object($payload->inputs)) {
            throw new RuntimeException($clientClass . ' must send an input object; got ' . json_encode($payload->inputs));
        }
        if ((array) $payload->inputs !== (array) $inputs) {
            throw new RuntimeException('Input values or nested arrays changed');
        }
        if ($request->getMethod() !== 'POST'
            || $request->getUri()->getPath() !== '/v1/' . $endpoint
            || $request->getHeaderLine('Authorization') !== 'Bearer test-api-key'
            || $payload->user !== 'test-user'
            || $payload->response_mode !== 'blocking') {
            throw new RuntimeException('Request route, credentials or mode changed');
        }
        ++$count;
    }
}

echo "Input object regression: {$count} requests passed\n";

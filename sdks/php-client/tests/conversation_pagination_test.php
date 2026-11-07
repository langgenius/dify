<?php

require dirname(__DIR__) . '/vendor/autoload.php';

use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;

$cursor = '11111111-1111-4111-8111-111111111111';
$conversationId = '22222222-2222-4222-8222-222222222222';
$user = 'user+tag@example.com';
$history = [];
$stack = HandlerStack::create(new MockHandler([
    new Response(200, [], '{"data":[{"id":"' . $cursor . '"}],"has_more":true}'),
    new Response(200, [], '{"data":[],"has_more":false}'),
    new Response(200, [], '{"data":[],"has_more":false}'),
]));
$stack->push(Middleware::history($history));
$client = new ChatClient('test-api-key');
$property = new ReflectionProperty(DifyClient::class, 'client');
if (PHP_VERSION_ID < 80100) {
    $property->setAccessible(true);
}
// Keep the real SDK and Guzzle URI/query serialization; replace only HTTP transport.
$property->getValue($client)->getConfig('handler')->setHandler($stack);

$firstPage = json_decode((string) $client->get_conversations($user, null, 1)->getBody(), true);
$client->get_conversations($user, $firstPage['data'][0]['id'], 1);
$client->get_conversation_messages($user, $conversationId, $cursor, 1);

foreach ($history as $transaction) {
    $request = $transaction['request'];
    if ($request->getMethod() !== 'GET'
        || $request->getHeaderLine('Authorization') !== 'Bearer test-api-key') {
        throw new RuntimeException('Request method or authentication changed');
    }
}

parse_str($history[0]['request']->getUri()->getQuery(), $firstQuery);
parse_str($history[1]['request']->getUri()->getQuery(), $nextQuery);
parse_str($history[2]['request']->getUri()->getQuery(), $messageQuery);
if ($firstQuery !== ['user' => $user, 'limit' => '1']) {
    throw new RuntimeException('First page must not send a cursor');
}
if ($history[1]['request']->getUri()->getPath() !== '/v1/conversations'
    || $nextQuery !== ['user' => $user, 'last_id' => $cursor, 'limit' => '1']) {
    throw new RuntimeException('Conversation pagination must send last_id; got ' . json_encode($nextQuery));
}
if ($history[2]['request']->getUri()->getPath() !== '/v1/messages'
    || $messageQuery !== ['user' => $user, 'conversation_id' => $conversationId, 'first_id' => $cursor, 'limit' => '1']) {
    throw new RuntimeException('Message pagination must retain first_id');
}

echo "Conversation pagination regression: 3 requests passed\n";

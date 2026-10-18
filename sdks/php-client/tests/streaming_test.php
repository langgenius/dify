<?php

require dirname(__DIR__) . '/vendor/autoload.php';

use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;

$client = new class('test-key') extends WorkflowClient {
    public function recordRequests(array &$history): void {
        // Keep the SDK's real Guzzle defaults and middleware; replace only transport.
        $stack = $this->client->getConfig('handler');
        $stack->setHandler(new MockHandler([
            new Response(200, ['Content-Type' => 'text/event-stream'], "data: {}\n\n"),
            new Response(200, ['Content-Type' => 'application/json'], '{}'),
        ]));
        $stack->push(Middleware::history($history));
    }
};
$history = [];
$client->recordRequests($history);

foreach (['streaming', 'blocking'] as $index => $mode) {
    $response = $client->run(['text' => 'hello'], $mode, 'test-user');
    $transaction = $history[$index];
    $request = $transaction['request'];
    if ($transaction['options']['stream'] !== ($mode === 'streaming')) {
        throw new RuntimeException('Wrong Guzzle stream option for response_mode=' . $mode);
    }
    if ($request->getMethod() !== 'POST' || $request->getUri()->getPath() !== '/v1/workflows/run') {
        throw new RuntimeException('Workflow endpoint changed');
    }
    if (json_decode((string) $request->getBody(), true) !== [
        'inputs' => ['text' => 'hello'],
        'response_mode' => $mode,
        'user' => 'test-user',
    ]) {
        throw new RuntimeException('Workflow JSON payload changed');
    }
    if ($request->getHeaderLine('Authorization') !== 'Bearer test-key' || $response->getStatusCode() !== 200) {
        throw new RuntimeException('Authentication or response changed');
    }
}

echo "Workflow streaming and blocking request checks passed.\n";


foreach ([true, false] as $streaming) {
    $client = new class('test-key') extends DifyClient {
        public function recordRequests(array &$history): void {
            $stack = $this->client->getConfig('handler');
            $stack->setHandler(new MockHandler([new Response(200, ['Content-Type' => 'audio/wav'], 'audio')]));
            $stack->push(Middleware::history($history));
        }
    };
    $history = [];
    $client->recordRequests($history);
    $response = $client->text_to_audio('hello', 'test-user', $streaming);
    $transaction = $history[0];
    $request = $transaction['request'];
    if ($transaction['options']['stream'] !== $streaming) {
        throw new RuntimeException('Wrong Guzzle stream option for text_to_audio');
    }
    if ($request->getMethod() !== 'POST' || $request->getUri()->getPath() !== '/v1/text-to-audio') {
        throw new RuntimeException('Text-to-audio endpoint changed');
    }
    if (json_decode((string) $request->getBody(), true) !== [
        'text' => 'hello',
        'user' => 'test-user',
        'streaming' => $streaming,
    ]) {
        throw new RuntimeException('Text-to-audio JSON payload changed');
    }
    if ($request->getHeaderLine('Authorization') !== 'Bearer test-key' || $response->getStatusCode() !== 200) {
        throw new RuntimeException('Authentication or response changed');
    }
}

echo "Text-to-audio streaming and buffered request checks passed.\n";

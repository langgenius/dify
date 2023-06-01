<?php

require 'vendor/autoload.php';

use GuzzleHttp\Client;

class DifyClient {
    protected $api_key;
    protected $base_url;
    protected $client;

    public function __construct($api_key) {
        $this->api_key = $api_key;
        $this->base_url = "https://api.dify.ai/v1/";
        $this->client = new Client([
            'base_uri' => $this->base_url,
            'headers' => [
                'Authorization' => 'Bearer ' . $this->api_key,
                'Content-Type' => 'application/json',
            ],
        ]);
    }

    protected function send_request($method, $endpoint, $data = null, $params = null, $stream = false) {
        $options = [
            'json' => $data,
            'query' => $params,
            'stream' => $stream,
        ];

        $response = $this->client->request($method, $endpoint, $options);
        return $response;
    }

    public function message_feedback($message_id, $rating, $user) {
        $data = [
            'rating' => $rating,
            'user' => $user,
        ];
        return $this->send_request('POST', "messages/{$message_id}/feedbacks", $data);
    }

    public function get_application_parameters($user) {
        $params = ['user' => $user];
        return $this->send_request('GET', 'parameters', null, $params);
    }
}

class CompletionClient extends DifyClient {
    public function create_completion_message($inputs, $query, $response_mode, $user) {
        $data = [
            'inputs' => $inputs,
            'query' => $query,
            'response_mode' => $response_mode,
            'user' => $user,
        ];
        return $this->send_request('POST', 'completion-messages', $data, null, $response_mode === 'streaming');
    }
}

class ChatClient extends DifyClient {
    public function create_chat_message($inputs, $query, $user, $response_mode = 'blocking', $conversation_id = null) {
        $data = [
            'inputs' => $inputs,
            'query' => $query,
            'user' => $user,
            'response_mode' => $response_mode,
        ];
        if ($conversation_id) {
            $data['conversation_id'] = $conversation_id;
        }

        return $this->send_request('POST', 'chat-messages', $data, null, $response_mode === 'streaming');
    }

    public function get_conversation_messages($user, $conversation_id = null, $first_id = null, $limit = null) {
        $params = ['user' => $user];

        if ($conversation_id) {
            $params['conversation_id'] = $conversation_id;
        }
        if ($first_id) {
            $params['first_id'] = $first_id;
        }
        if ($limit) {
            $params['limit'] = $limit;
        }

        return $this->send_request('GET', 'messages', null, $params);
    }

    public function get_conversations($user, $first_id = null, $limit = null, $pinned = null) {
        $params = [
            'user' => $user,
            'first_id' => $first_id,
            'limit' => $limit,
            'pinned'=> $pinned,
        ];
        return $this->send_request('GET', 'conversations', null, $params);
    }

    public function rename_conversation($conversation_id, $name, $user) {
        $data = [
            'name' => $name,
            'user' => $user,
        ];
        return $this->send_request('PATCH', "conversations/{$conversation_id}", $data);
    }
}

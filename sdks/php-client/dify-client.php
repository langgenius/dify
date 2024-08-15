<?php

require 'vendor/autoload.php';

use GuzzleHttp\Client;

class DifyClient {
    protected $api_key;
    protected $base_url;
    protected $client;

    public function __construct($api_key, $base_url = null) {
        $this->api_key = $api_key;
        $this->base_url = $base_url ?? "https://api.dify.ai/v1/";
        $this->client = new Client([
            'base_uri' => $this->base_url,
            'headers' => [
                'Authorization' => 'Bearer ' . $this->api_key,
                'Content-Type' => 'application/json',
            ],
        ]);
        $this->file_client = new Client([
            'base_uri' => $this->base_url,
            'headers' => [
                'Authorization' => 'Bearer ' . $this->api_key,
                'Content-Type' => 'multipart/form-data',
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

    public function file_upload($user, $files) {
        $data = ['user' => $user];
        $options = [
            'multipart' => $this->prepareMultipart($data, $files)
        ];

        return $this->file_client->request('POST', 'files/upload', $options);
    }

    protected function prepareMultipart($data, $files) {
        $multipart = [];
        foreach ($data as $key => $value) {
            $multipart[] = [
                'name' => $key,
                'contents' => $value
            ];
        }

        foreach ($files as $file) {
            $multipart[] = [
                'name' => 'file',
                'contents' => fopen($file['tmp_name'], 'r'),
                'filename' => $file['name']
            ];
        }

        return $multipart;
    }


    public function text_to_audio($text, $user, $streaming = false) {
        $data = [
            'text' => $text,
            'user' => $user,
            'streaming' => $streaming
        ];

        return $this->send_request('POST', 'text-to-audio', $data);
    }

    public function get_meta($user) {
        $params = [
            'user' => $user
        ];

        return $this->send_request('GET', 'meta',null, $params);
    }
}

class CompletionClient extends DifyClient {
    public function create_completion_message($inputs, $response_mode, $user, $files = null) {
        $data = [
            'inputs' => $inputs,
            'response_mode' => $response_mode,
            'user' => $user,
            'files' => $files,
        ];
        return $this->send_request('POST', 'completion-messages', $data, null, $response_mode === 'streaming');
    }
}

class ChatClient extends DifyClient {
    public function create_chat_message($inputs, $query, $user, $response_mode = 'blocking', $conversation_id = null, $files = null) {
        $data = [
            'inputs' => $inputs,
            'query' => $query,
            'user' => $user,
            'response_mode' => $response_mode,
            'files' => $files,
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

    
    public function stop_message($task_id, $user) {
        $data = ['user' => $user];
        return $this->send_request('POST', "chat-messages/{$task_id}/stop", $data);
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

    public function audio_to_text($audio_file, $user) {
        $data = [
            'user' => $user,
        ];
        $options = [
            'multipart' => $this->prepareMultipart($data, $files)
        ];
        return $this->file_client->request('POST', 'audio-to-text', $options);
        
    }

        
    public function get_suggestions($message_id, $user) {
        $params = [
            'user' => $user
        ]
        return $this->send_request('GET', "messages/{$message_id}/suggested", null, $params);
    }
}

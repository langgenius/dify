require 'net/http'
require 'json'
require 'uri'

class DifyClient
    def initialize(api_key)
        @api_key = api_key
        @base_url = "https://api.dify.ai/v1"
    end

    def _send_request(method, endpoint, data = nil, params = nil, stream = false)
        uri = URI.parse("#{@base_url}#{endpoint}")

        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = true

        headers = {
            "Authorization" => "Bearer #{@api_key}",
            "Content-Type" => "application/json"
        }

        if method == "GET"
            uri.query = URI.encode_www_form(params) if params
            request = Net::HTTP::Get.new(uri.request_uri, headers)
        elsif method == "POST"
            request = Net::HTTP::Post.new(uri.request_uri, headers)
            request.body = data.to_json
        end

        response = http.request(request)
        return response
    end

    def message_feedback(message_id, rating, user)
        data = {
            rating: rating,
            user: user
        }
        return _send_request("POST", "/messages/#{message_id}/feedbacks", data)
    end

    def get_application_parameters(user)
        params = {user: user}
        return _send_request("GET", "/parameters", nil, params)
    end
end

class CompletionClient < DifyClient
    def create_completion_message(inputs, query, response_mode, user)
        data = {
            inputs: inputs,
            query: query,
            response_mode: response_mode,
            user: user
        }
        return _send_request("POST", "/completion-messages", data, nil, response_mode == "streaming")
    end
end

class ChatClient < DifyClient
    def create_chat_message(inputs, query, user, response_mode = "blocking", conversation_id = nil)
        data = {
            inputs: inputs,
            query: query,
            user: user,
            response_mode: response_mode
        }
        data[:conversation_id] = conversation_id if conversation_id

        return _send_request("POST", "/chat-messages", data, nil, response_mode == "streaming")
    end

    def get_conversation_messages(user, conversation_id = nil, first_id = nil, limit = nil)
        params = {user: user}
        params[:conversation_id] = conversation_id if conversation_id
        params[:first_id] = first_id if first_id
        params[:limit] = limit if limit

        return _send_request("GET", "/messages", nil, params)
    end

    def get_conversations(user, last_id = nil, limit = nil, pinned = nil)
        params = {user: user, last_id: last_id, limit: limit, pinned: pinned}
        return _send_request("GET", "/conversations", nil, params)
    end

    def rename_conversation(conversation_id, name, user)
        data = {name: name, user: user}
        return _send_request("POST", "/conversations/#{conversation_id}/name", data)
    end
end

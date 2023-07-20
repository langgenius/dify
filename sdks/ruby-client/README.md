# DifyClient

Welcome to the DifyClient gem! This gem provides a Ruby client for interacting with the Dify.ai API. It allows you to perform various actions such as sending requests, providing feedback, creating completion messages, managing conversations, and more.

## Installation

Add this line to your application's Gemfile:

```ruby
gem 'dify_client'
```

And then execute:

    $ bundle install

Or install it yourself as:

    $ gem install dify_client

## Usage

To use the DifyClient gem, follow these steps:

1 Require the gem:

```ruby
require 'dify_client'
```
2 Create a new client instance:

```ruby
api_key = 'YOUR_API_KEY'
client = DifyClient::Client.new(api_key)
```

3 Use the available methods to interact with the Dify.ai API. Here are the methods provided by the DifyClient::Client class:

### Update API Key

```ruby
client.update_api_key('NEW_API_KEY')
```
Updates the API key used by the client.

### Message Feedback

```ruby
client.message_feedback(message_id, rating, user)
```

Submits feedback for a specific message identified by `message_id`. The `rating` parameter should be the rating value, and `user` is the user identifier.

### Get Application Parameters

```ruby
client.get_application_parameters(user)
```

### Create Completion Message

```ruby
client.create_completion_message(inputs, query, user, stream = false)
```

Creates a completion message with the provided `inputs`, `query`, and `user`. The stream parameter is optional and set to `false` by default. Set it to `true` to enable streaming response mode.


### Create Chat Message

```ruby
client.create_chat_message(inputs, query, user, stream = false, conversation_id = nil)
```

Creates a chat message with the provided `inputs`, `query`, and `user`. The stream parameter is optional and set to `false` by default. Set it to `true` to enable streaming response mode. The `conversation_id` parameter is optional and can be used to specify the conversation ID.

### Get Conversations

```ruby
client.get_conversations(user, first_id = nil, limit = nil, pinned = nil)
```
Retrieves the conversations for a given `user`. You can provide `first_id`, `limit`, and `pinned` parameters to customize the retrieval.

### Rename Conversation

```ruby
client.rename_conversation(conversation_id, name, user)
```
Renames a conversation identified by conversatio`n_id with the provided `name` for the given `user`.

### Delete Conversation

```ruby
client.delete_conversation(conversation_id, user)
```
Deletes a conversation identified by `conversation_id` for the given `user`.

## Development

After checking out the repo, run `bin/setup` to install dependencies. Then, run `rake test` to run the tests. You can also run `bin/console` for an interactive prompt that will allow you to experiment.

To install this gem onto your local machine, run `bundle exec rake install`. To release a new version, update the version number in `version.rb`, and then run` bundle exec rake release`, which will create a git tag for the version, push git commits and the created tag, and push the .gem file to rubygems.org.


## Contributing

Bug reports and pull requests are welcome on GitHub at [https://github.com/langgenius/dify/issues](https://github.com/langgenius/dify/issues).

## License

The gem is available as open source under the terms of the [MIT License](https://opensource.org/licenses/MIT).
require 'test_helper'
require 'webmock/minitest'
require 'json'
require 'dify_client'

class DifyClientTest < Minitest::Test
  def setup
    @api_key = 'YOUR_API_KEY'
    @client = DifyClient::Client.new(@api_key)
  end

  def test_update_api_key
    new_api_key = 'NEW_API_KEY'

    @client.update_api_key(new_api_key)

    assert_equal new_api_key, @client.instance_variable_get(:@api_key)
  end

  def test_get_application_parameters
    user = 'USER_ID'
    expected_response = {}

    stub_request(:get, "https://api.dify.ai/v1/parameters").
    with(
      body: {"user"=>"USER_ID"},
      headers: {
      'Accept'=>'*/*',
      'Accept-Encoding'=>'gzip;q=1.0,deflate;q=0.6,identity;q=0.3',
      'Authorization'=>'Bearer YOUR_API_KEY',
      'Content-Type'=>'application/x-www-form-urlencoded',
      'Responsetype'=>'json',
      'User-Agent'=>'Ruby'
      }).
    to_return(status: 200, body: expected_response.to_json, headers: {})

    response = @client.get_application_parameters(user)

    assert_equal expected_response, response
  end

end

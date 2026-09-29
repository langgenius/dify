const OpenAI = require("openai");

let _defaultClient;

function getClient(apiKey) {
  if (apiKey) {
    return new OpenAI({ apiKey });
  }
  if (!_defaultClient) {
    _defaultClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _defaultClient;
}

module.exports = { getClient };

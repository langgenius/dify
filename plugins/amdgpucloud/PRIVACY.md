# Privacy

AMDGPUCloud sends the configured AMD GPU Cloud API key and model requests to
`https://developer.amd.com.cn`. Requests may include model IDs, prompts,
conversation messages, images, tool definitions, tool results, and generation
parameters. Responses may include generated content, reasoning content, tool
calls, usage data, request IDs, and errors.

The plugin adds the fixed request header `X-Source: dify` for aggregate channel
attribution. The header does not identify a Dify user, workspace, application,
conversation, or request. The plugin does not add persistent storage or its own
analytics service.

Model discovery calls the same fixed AMD `/models` endpoint with the user's
configured key. Public model metadata may be held in process memory for at most
30 seconds, keyed by a credential digest and scoped by tenant/provider in the
API adapter. The cache never persists keys or prompts and no background polling
is started. The local Dify compatibility overlay follows the same data flow.

AMD GPU Cloud / Token Factory and the selected model service may process and log request data,
IP addresses, request IDs, and usage metadata to provide, secure, operate, and
bill the service. Review AMD's privacy policy and the Token Factory terms before
using the plugin with sensitive data.

AMD Privacy Policy: <https://www.amd.com/en/corporate/privacy.html>

Privacy questions for this integration can be sent to
**Letian Kang** at `Letian.Kang@amd.com` during development.

The API-key help page opens in the user's browser and does not automatically
authorize the plugin. The packaged logo is a local PNG; displaying it does not
make a request to the logo's source website or add browser tracking.

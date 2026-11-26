# Dify Node.js SDK

This is the Node.js SDK for the Dify API, which allows you to easily integrate Dify into your Node.js applications.

## Install

```bash
npm install dify-client
```

## Usage

After installing the SDK, you can use it in your project like this:

```js
import {
  DifyClient,
  ChatClient,
  CompletionClient,
  WorkflowClient,
  KnowledgeBaseClient,
  WorkspaceClient,
} from 'dify-client'

const API_KEY = 'your-app-api-key'
const DATASET_API_KEY = 'your-dataset-api-key'
const user = 'random-user-id'
const query = 'Please tell me a short story in 10 words or less.'

const chatClient = new ChatClient(API_KEY)
const completionClient = new CompletionClient(API_KEY)
const workflowClient = new WorkflowClient(API_KEY)
const kbClient = new KnowledgeBaseClient(DATASET_API_KEY)
const workspaceClient = new WorkspaceClient(DATASET_API_KEY)
const client = new DifyClient(API_KEY)

// App core
await client.getApplicationParameters(user)
await client.messageFeedback('message-id', 'like', user)

// Completion (blocking)
await completionClient.createCompletionMessage({
  inputs: { query },
  user,
  response_mode: 'blocking',
})

// Chat (streaming)
const stream = await chatClient.createChatMessage({
  inputs: {},
  query,
  user,
  response_mode: 'streaming',
})
for await (const event of stream) {
  console.log(event.event, event.data)
}

// Chatflow (advanced chat via workflow_id)
await chatClient.createChatMessage({
  inputs: {},
  query,
  user,
  workflow_id: 'workflow-id',
  response_mode: 'blocking',
})

// Workflow run (blocking or streaming)
await workflowClient.run({
  inputs: { query },
  user,
  response_mode: 'blocking',
})

// Knowledge base (dataset token required)
await kbClient.listDatasets({ page: 1, limit: 20 })
await kbClient.createDataset({ name: 'KB', indexing_technique: 'economy' })

// RAG pipeline (may require service API route registration)
const pipelineStream = await kbClient.runPipeline('dataset-id', {
  inputs: {},
  datasource_type: 'online_document',
  datasource_info_list: [],
  start_node_id: 'start-node-id',
  is_published: true,
  response_mode: 'streaming',
})
for await (const event of pipelineStream) {
  console.log(event.data)
}

// Workspace models (dataset token required)
await workspaceClient.getModelsByType('text-embedding')
```

Notes:

- For attachment-only retrieval testing, use `kbClient.hitTesting(datasetId, { query: '', attachment_ids: [fileId] })`.
- App endpoints use an app API token; knowledge base and workspace endpoints use a dataset API token.
- Chat/completion require a stable `user` identifier in the request payload.
- Pagination cursors for `getConversations`, `getConversationMessages`, and `getConversationVariables` may be omitted, `null`, or `''` to request the first page.
- For streaming responses, iterate the returned AsyncIterable. Use `stream.toText()` to collect text.
- `stream.toText()` rejects with `APIError` when Dify sends an `error` event, even if the HTTP status is 200. Iterating the stream directly still yields these events for custom handling.

## Human Input and workflow reconnection

`WorkflowClient` and `ChatClient` can fetch and submit paused Human Input forms with WebApp delivery, then reconnect to the workflow's event stream. Use the `form_token` from the `human_input_required` event and the run's `workflow_run_id`. The submitting `user` identifies the person responding; event reconnection requires the same `user` that originally started the run.

```js
const { data: form } = await workflowClient.getHumanInputForm(formToken)
console.log(form.form_content, form.inputs, form.user_actions)

await workflowClient.submitHumanInputForm(formToken, {
  user,
  action: selectedActionId, // One of form.user_actions[].id
  inputs: submittedValues, // Keyed by each input's output_variable_name
})

const resumed = await workflowClient.getWorkflowEvents(workflowRunId, user, {
  includeStateSnapshot: true,
  continueOnPause: true,
})
for await (const event of resumed) {
  console.log(event.data)
}
```

Forms can be submitted once. Expired or already submitted forms retain the API's error response. `getWorkflowEvents` also reconnects after a dropped connection without submitting a form, and completed runs emit a `workflow_finished` event before closing.

## Maintainers

This package is published from the repository workspace. Install dependencies from the repository root with `pnpm install`, then run the following commands from the same directory so `catalog:` dependencies are resolved before release:

```sh
# Check the package without publishing
./sdks/nodejs-client/scripts/publish.sh --dry-run

# Publish the package
./sdks/nodejs-client/scripts/publish.sh
```

## License

This SDK is released under the MIT License.

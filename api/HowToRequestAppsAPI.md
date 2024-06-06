# Making HTTP Requests to Dify API with API Key Authentication

In modern software development, having a robust application deployment mechanism is crucial for enabling Continuous Integration and Continuous Deployment (CI/CD) in an unattended (automated) manner. CI/CD pipelines ensure that code changes are automatically built, tested, and deployed, improving the speed and reliability of software delivery. Integrating a secure and efficient deployment process allows teams to focus on development and innovation while reducing manual errors and downtime. In this context, being able to interact programmatically with the Dify API for managing applications becomes essential.

In this tutorial, we will learn how to make HTTP requests to the Dify API for importing, exporting, listing, creating, updating, and retrieving applications. We'll use API key authentication, which requires the environment variables `ADMIN_API_KEY_ENABLE` to be set to `true` and `ADMIN_API_KEY` to be set with a unique key in the service API container (running the image `langgenius/dify-api`). You can create an API key using the following command:

```sh
openssl rand -base64 42
```

### Prerequisites

1. Ensure the service API container is running with the following environment variables:
   - `ADMIN_API_KEY_ENABLE=true`
   - `ADMIN_API_KEY=<your_unique_api_key>`

2. Replace `<your_unique_api_key>` with your actual API key in the examples below.

3. Obtain the `workspace_id` that you will use for the `X-WORKSPACE-ID` header.

### Obtaining the X-WORKSPACE-ID

To obtain the `X-WORKSPACE-ID`, you can use your browser's developer tools:

1. Open your browser and navigate to the Dify application.
2. Log in if required.
3. Open Developer Tools (usually by pressing `F12` or `Ctrl+Shift+I`).
4. Go to the `Network` tab.
5. Refresh the page or perform an action that loads the workspaces.
6. Look for a network request to the `workspaces` endpoint.
7. Click on that request and check the `Response` tab to find the workspace ID.

The response will include a list of workspaces with their IDs. Here’s an example of what the response might look like:

```json
{
  "workspaces": [
    {
      "id": "de85345f-d464-4e0f-a2a3-5e091a86df31",
      "name": "checkhox's workspace",
      "plan": "basic",
      "status": "normal"
    }
  ]
}
```

Use the `id` field from the response as your `workspace_id`.

### HTTP Requests with API Key Authentication

When making requests to the Dify API, include the following headers:
- `Authorization: Bearer <your_unique_api_key>`
- `X-WORKSPACE-ID: <workspace_id>`
- `Content-Type: application/json` (recommended for JSON payloads)

#### Importing Applications

To import an application, you need to send a `POST` request with the necessary data in the request body. The required fields are `data`, and you can optionally include `name`, `description`, `icon`, and `icon_background`.

```http
POST /console/api/apps/import
Authorization: Bearer <your_unique_api_key>
X-WORKSPACE-ID: <workspace_id>
Content-Type: application/json

{
  "data": "base64_encoded_app_data",
  "name": "Application Name",
  "description": "Application Description",
  "icon": "Icon URL",
  "icon_background": "Icon Background Color"
}
```

#### Exporting Applications

To export an application, send a `GET` request with the application ID in the URL. The response will contain the application's data in a base64 encoded format.

```http
GET /console/api/apps/{app_id}/export
Authorization: Bearer <your_unique_api_key>
X-WORKSPACE-ID: <workspace_id>
Accept: application/json
```

Example response:
```json
{
  "data": "base64_encoded_app_data"
}
```

#### Listing Applications

To list all applications, send a `GET` request.

```http
GET /console/api/apps?page=1&limit=30&name=
Authorization: Bearer <your_unique_api_key>
X-WORKSPACE-ID: <workspace_id>
Accept: application/json
```

#### Creating Applications

To create a new application, send a `POST` request with the application details in the request body. Ensure to include all necessary arguments, with `mode` being one of the allowed modes: `['chat', 'agent-chat', 'advanced-chat', 'workflow', 'completion']`.

```http
POST /console/api/apps
Authorization: Bearer <your_unique_api_key>
X-WORKSPACE-ID: <workspace_id>
Content-Type: application/json

{
  "name": "Application Name",
  "description": "Application Description",
  "mode": "chat",  // Ensure this is one of the ALLOW_CREATE_APP_MODES
  "icon": "Icon URL",
  "icon_background": "Icon Background Color"
}
```

#### Updating an Application

To update an existing application, send a `PUT` request with the application ID in the URL and the updated details in the request body.

```http
PUT /console/api/apps/{app_id}
Authorization: Bearer <your_unique_api_key>
X-WORKSPACE-ID: <workspace_id>
Content-Type: application/json

{
  "name": "Updated Application Name",
  "description": "Updated Application Description",
  "icon": "Updated Icon URL",
  "icon_background": "Updated Icon Background Color"
}
```

#### Retrieving a Specific Application

To retrieve a specific application by its ID, send a `GET` request with the application ID in the URL.

```http
GET /console/api/apps/{app_id}
Authorization: Bearer <your_unique_api_key>
X-WORKSPACE-ID: <workspace_id>
Accept: application/json
```

### Example Requests Using cURL

Here are example cURL commands for each operation:

1. **Importing an Application**:
    ```sh
    curl -X POST http://your.api.endpoint/console/api/apps/import \
    -H "Authorization: Bearer <your_unique_api_key>" \
    -H "X-WORKSPACE-ID: <workspace_id>" \
    -H "Content-Type: application/json" \
    -d '{
      "data": "base64_encoded_app_data",
      "name": "Application Name",
      "description": "Application Description",
      "icon": "Icon URL",
      "icon_background": "Icon Background Color"
    }'
    ```

2. **Exporting an Application**:
    ```sh
    curl -X GET http://your.api.endpoint/console/api/apps/{app_id}/export \
    -H "Authorization: Bearer <your_unique_api_key>" \
    -H "X-WORKSPACE-ID: <workspace_id>" \
    -H "Accept: application/json"
    ```

3. **Listing Applications**:
    ```sh
    curl -X GET "http://your.api.endpoint/console/api/apps?page=1&limit=30&name=" \
    -H "Authorization: Bearer <your_unique_api_key>" \
    -H "X-WORKSPACE-ID: <workspace_id>" \
    -H "Accept: application/json"
    ```

4. **Creating an Application**:
    ```sh
    curl -X POST http://your.api.endpoint/console/api/apps \
    -H "Authorization: Bearer <your_unique_api_key>" \
    -H "X-WORKSPACE-ID: <workspace_id>" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Application Name",
      "description": "Application Description",
      "mode": "chat",
      "icon": "Icon URL",
      "icon_background": "Icon Background Color"
    }'
    ```

5. **Updating an Application**:
    ```sh
    curl -X PUT http://your.api.endpoint/console/api/apps/{app_id} \
    -H "Authorization: Bearer <your_unique_api_key>" \
    -H "X-WORKSPACE-ID: <workspace_id>" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Updated Application Name",
      "description": "Updated Application Description",
      "icon": "Updated Icon URL",
      "icon_background": "Updated Icon Background Color"
    }'
    ```

6. **Retrieving a Specific Application**:
    ```sh
    curl -X GET http://your.api.endpoint/console/api/apps/{app_id} \
    -H "Authorization: Bearer <your_unique_api_key>" \
    -H "X-WORKSPACE-ID: <workspace_id>" \
    -H "Accept: application/json"
    ```

### Conclusion

By following this tutorial, you can securely interact with the Dify API using API key authentication. Ensure your service API container is correctly configured with the necessary environment variables to enable and use the API key. Always include the `X-WORKSPACE-ID` header in your requests to specify the workspace context.
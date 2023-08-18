# Install(Self hosted)

The Dify Self hosted Edition, which is the open-source on [GitHub](https://github.com/langgenius/dify), can be deployed in one of the following two ways:

1. [Docker Compose Deployment](https://docs.dify.ai/v/zh-hans/getting-started/install-self-hosted/docker-compose)
2. [Local Source Code Start](https://docs.dify.ai/v/zh-hans/getting-started/install-self-hosted/local-source-code)



### FAQ

*   **The page keeps loading after startup, and I see a CORS error in the request.**

    This may be due to a domain/URL change, causing a cross-origin issue between the frontend and backend. Please update the following configuration items in the docker-compose.yml file with the new domain:

    `CONSOLE_URL`: Console domain, e.g., `http://localhost:8080`

    `API_URL`: Service API domain

    `APP_URL`: Web APP domain
*   **After installation, I can't log in. Although the login is successful, all subsequent API calls return a 401 error.**

    This issue may be related to cross-origin problems causing the cookie policy to fail. You can configure it according to the following strategies:

    *   Default Strategy

        This strategy is suitable for local debugging and supports both HTTP and HTTPS protocols, but it requires the frontend and API to be on the same domain.

        ```
        WEB_API_CORS_ALLOW_ORIGINS: '*'
        CONSOLE_CORS_ALLOW_ORIGINS: '*'
        COOKIE_HTTPONLY: 'true'
        COOKIE_SAMESITE: 'Lax'
        COOKIE_SECURE: 'false'
        ```
    *   Cross-Origin Strategy (Do not use in production)

        Since SameSite=None must be used with Secure=true, the server must use the HTTPS protocol to enable cross-origin access. This strategy can be used when the server is remote and supports HTTPS, or when running the frontend and backend projects separately locally (localhost but on different ports, it works but may show a warning).

        ```
        WEB_API_CORS_ALLOW_ORIGINS: '*'
        CONSOLE_CORS_ALLOW_ORIGINS: '*'
        COOKIE_HTTPONLY: 'true'
        COOKIE_SAMESITE: 'Lax'
        COOKIE_SECURE: 'false'
        ```
    *   Production Strategy

        Due to the requirement of supporting callback with cookie information for some third-party integrations, the strictest Strict strategy cannot be used. Therefore, CORS domains need to be strictly limited, and the cookie policy should be set to SameSite=Lax Secure=true.

        ```
        WEB_API_CORS_ALLOW_ORIGINS: 'https://your-domain-for-web-app'
        CONSOLE_CORS_ALLOW_ORIGINS: 'https://your-domain-for-console'
        COOKIE_HTTPONLY: 'true'
        COOKIE_SAMESITE: 'Lax'
        COOKIE_SECURE: 'true'
        ```
*   **How to configure and use Azure OpenAI**

    Currently, Azure OpenAI support is not fully available, and you need to create a deployment with the specified names to use it:

    * gpt-35-turbo
    * gpt-4
    * text-davinci-003
    * text-embedding-ada-002

    Please note that all deployment names should not contain periods (".").

    Looks like:

    ![](<../../.gitbook/assets/image (33).png>)

### Contributing

To ensure proper review, all code contributions - including those from contributors with direct commit access - must be submitted via pull requests and approved by the core development team prior to being merged.

We welcome all pull requests! If you'd like to help, check out the [Contribution Guide](https://github.com/langgenius/dify/blob/main/CONTRIBUTING.md) for more information on how to get started.

# Local Source Code Start

## Prerequisites

| Operating System           | Software                                                       | Explanation                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS 10.14 or later       | Docker Desktop                                                 | Set the Docker virtual machine (VM) to use a minimum of 2 virtual CPUs (vCPUs) and 8 GB of initial memory. Otherwise, the installation may fail. For more information, please refer to the [Docker Desktop installation guide for Mac](https://docs.docker.com/desktop/mac/install/).                                                     |
| Linux platforms            | <p>Docker 19.03 or later<br>Docker Compose 1.25.1 or later</p> | Please refer to the [Docker installation guide](https://docs.docker.com/engine/install/) and [the Docker Compose installation guide](https://docs.docker.com/compose/install/) for more information on how to install Docker and Docker Compose, respectively.                                                                            |
| Windows with WSL 2 enabled | <p>Docker Desktop<br></p>                                      | We recommend storing the source code and other data that is bound to Linux containers in the Linux file system rather than the Windows file system. For more information, please refer to the [Docker Desktop installation guide for using the WSL 2 backend on Windows.](https://docs.docker.com/desktop/windows/install/#wsl-2-backend) |

### Clone Dify

```Bash
git clone https://github.com/langgenius/dify.git
```

Before enabling business services, we need to first deploy PostgresSQL / Redis / Weaviate (if not locally available). We can start them with the following commands:

```Bash
cd docker
docker compose -f docker-compose.middleware.yaml up -d
```

***

### Server Deployment

* API Interface Service
* Worker Asynchronous Queue Consumption Service

#### Installation of the basic environment:

Server startup requires Python 3.10.x. It is recommended to use [Anaconda](https://docs.anaconda.com/free/anaconda/install/) for quick installation of the Python environment, which already includes the pip package management tool.

To create a Python 3.10 environment named "dify," you can use the following command:

```Bash
conda create --name dify python=3.10
```

To switch to the "dify" Python environment, use the following command:

```
conda activate dify
```

#### Follow these steps :

1.  Navigate to the "api" directory:

    <pre><code><strong>cd api
    </strong></code></pre>
2.  Copy the environment variable configuration file:

    ```
    cp .env.example .env
    ```
3.  Generate a random secret key and replace the value of SECRET_KEY in the .env file:

    ```
    openssl rand -base64 42
    sed -i 's/SECRET_KEY=.*/SECRET_KEY=<your_value>/' .env
    ```
4.  Install the required dependencies:

    <pre><code><strong>pip install -r requirements.txt
    </strong></code></pre>
5.  Perform the database migration

    Perform database migration to the latest version:

    <pre><code><strong>flask db upgrade6. Start the API server:
    </strong></code></pre>


6.  Start the API server:

    ```
    flask run --host 0.0.0.0 --port=5001 --debug
    ```

    output：

    ```
    * Debug mode: on
    INFO:werkzeug:WARNING: This is a development server. Do not use it in a production deployment. Use a production WSGI server instead.
     * Running on all addresses (0.0.0.0)
     * Running on http://127.0.0.1:5001
    INFO:werkzeug:Press CTRL+C to quit
    INFO:werkzeug: * Restarting with stat
    WARNING:werkzeug: * Debugger is active!
    INFO:werkzeug: * Debugger PIN: 695-801-919
    ```
7.  start the Worker service

    To consume asynchronous tasks from the queue, such as dataset file import and dataset document updates, follow these steps to start the Worker service on Linux or macOS:

    `celery -A app.celery worker -P gevent -c 1 -Q dataset,generation,mail --loglevel INFO`

    If you are using a Windows system to start the Worker service, please use the following command instead:

    ```
    celery -A app.celery worker -P solo --without-gossip --without-mingle -Q dataset,generation,mail --loglevel INFO
    ```

    output:

    ```
     -------------- celery@TAKATOST.lan v5.2.7 (dawn-chorus)
    --- ***** ----- 
    -- ******* ---- macOS-10.16-x86_64-i386-64bit 2023-07-31 12:58:08
    - *** --- * --- 
    - ** ---------- [config]
    - ** ---------- .> app:         app:0x7fb568572a10
    - ** ---------- .> transport:   redis://:**@localhost:6379/1
    - ** ---------- .> results:     postgresql://postgres:**@localhost:5432/dify
    - *** --- * --- .> concurrency: 1 (gevent)
    -- ******* ---- .> task events: OFF (enable -E to monitor tasks in this worker)
    --- ***** ----- 
     -------------- [queues]
                    .> dataset          exchange=dataset(direct) key=dataset
                    .> generation       exchange=generation(direct) key=generation
                    .> mail             exchange=mail(direct) key=mail

    [tasks]
      . tasks.add_document_to_index_task.add_document_to_index_task
      . tasks.clean_dataset_task.clean_dataset_task
      . tasks.clean_document_task.clean_document_task
      . tasks.clean_notion_document_task.clean_notion_document_task
      . tasks.create_segment_to_index_task.create_segment_to_index_task
      . tasks.deal_dataset_vector_index_task.deal_dataset_vector_index_task
      . tasks.document_indexing_sync_task.document_indexing_sync_task
      . tasks.document_indexing_task.document_indexing_task
      . tasks.document_indexing_update_task.document_indexing_update_task
      . tasks.enable_segment_to_index_task.enable_segment_to_index_task
      . tasks.generate_conversation_summary_task.generate_conversation_summary_task
      . tasks.mail_invite_member_task.send_invite_member_mail_task
      . tasks.remove_document_from_index_task.remove_document_from_index_task
      . tasks.remove_segment_from_index_task.remove_segment_from_index_task
      . tasks.update_segment_index_task.update_segment_index_task
      . tasks.update_segment_keyword_index_task.update_segment_keyword_index_task

    [2023-07-31 12:58:08,831: INFO/MainProcess] Connected to redis://:**@localhost:6379/1
    [2023-07-31 12:58:08,840: INFO/MainProcess] mingle: searching for neighbors
    [2023-07-31 12:58:09,873: INFO/MainProcess] mingle: all alone
    [2023-07-31 12:58:09,886: INFO/MainProcess] pidbox: Connected to redis://:**@localhost:6379/1.
    [2023-07-31 12:58:09,890: INFO/MainProcess] celery@TAKATOST.lan ready.
    ```

***

## Deploy the frontend page

Start the web frontend client page service

#### Installation of the basic environment:

To start the web frontend service, you will need [Node.js v18.x (LTS)](http://nodejs.org/) and [NPM version 8.x.x](https://www.npmjs.com/) or [Yarn](https://yarnpkg.com/).

* Install NodeJS + NPM

Please visit [https://nodejs.org/en/download](https://nodejs.org/en/download) and choose the installation package for your respective operating system that is v18.x or higher. It is recommended to download the stable version, which includes NPM by default.

#### Follow these steps :

1.  Enter the web directory

    ```
    cd web
    ```
2.  Install the dependencies.

    ```
    npm install
    ```
3.  Configure the environment variables. Create a file named .env.local in the current directory and copy the contents from .env.example. Modify the values of these environment variables according to your requirements:

    ```
    # For production release, change this to PRODUCTION
    NEXT_PUBLIC_DEPLOY_ENV=DEVELOPMENT
    # The deployment edition, SELF_HOSTED or CLOUD
    NEXT_PUBLIC_EDITION=SELF_HOSTED
    # The base URL of console application, refers to the Console base URL of WEB service if console domain is
    # different from api or web app domain.
    # example: http://cloud.dify.ai/console/api
    NEXT_PUBLIC_API_PREFIX=http://localhost:5001/console/api
    # The URL for Web APP, refers to the Web App base URL of WEB service if web app domain is different from
    # console or api domain.
    # example: http://udify.app/api
    NEXT_PUBLIC_PUBLIC_API_PREFIX=http://localhost:5001/api

    # SENTRY
    NEXT_PUBLIC_SENTRY_DSN=
    NEXT_PUBLIC_SENTRY_ORG=
    NEXT_PUBLIC_SENTRY_PROJECT=
    ```
4.  Build the code

    ```
    npm run build
    ```
5.  Start the web service:

    ```
    npm run start
    # or
    yarn start
    # or
    pnpm start
    ```

After successful startup, the terminal will output the following information：

```
ready - started server on 0.0.0.0:3000, url: http://localhost:3000
warn  - You have enabled experimental feature (appDir) in next.config.js.
warn  - Experimental features are not covered by semver, and may cause unexpected or broken application behavior. Use at your own risk.
info  - Thank you for testing `appDir` please leave your feedback at https://nextjs.link/app-feedback
```

### Access Dify

Finally, access [http://127.0.0.1:3000](http://127.0.0.1:3000/) to use the locally deployed Dify.

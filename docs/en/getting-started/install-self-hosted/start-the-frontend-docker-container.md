# Start the frontend Docker container separately

When developing the backend separately, you may only need to start the backend service from source code without building and launching the frontend locally. In this case, you can directly start the frontend service by pulling the Docker image and running the container. Here are the specific steps:

#### Pull the Docker image for the frontend service from DockerHub:

```Bash
docker run -it -p 3000:3000 -e EDITION=SELF_HOSTED -e CONSOLE_URL=http://127.0.0.1:3000 -e APP_URL=http://127.0.0.1:3000 langgenius/dify-web:latest
```

#### Build Docker Image from Source Code

1.  Build the frontend image：

    ```
    cd web && docker build . -t dify-web
    ```
2.  Start the frontend image

    ```
    docker run -it -p 3000:3000 -e EDITION=SELF_HOSTED -e CONSOLE_URL=http://127.0.0.1:3000 -e APP_URL=http://127.0.0.1:3000 dify-web
    ```
3. When the console domain and web app domain are different, you can set the CONSOLE_URL and APP_URL separately.
4. To access it locally, you can visit [http://127.0.0.1:3000](http://127.0.0.1:3000/).

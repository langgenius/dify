# 单独启动前端 Docker 容器

当单独开发后端时，可能只需要源码启动后端服务，而不需要本地构建前端代码并启动，因此可以直接通过拉取 docker 镜像并启动容器的方式来启动前端服务，以下为具体步骤：

#### 直接使用 DockerHub 镜像

```Bash
docker run -it -p 3000:3000 -e EDITION=SELF_HOSTED -e CONSOLE_URL=http://127.0.0.1:3000 -e APP_URL=http://127.0.0.1:3000 langgenius/dify-web:latest
```

#### 源码构建 Docker 镜像

1.  构建前端镜像

    ```
    cd web && docker build . -t dify-web
    ```
2.  启动前端镜像

    ```
    docker run -it -p 3000:3000 -e EDITION=SELF_HOSTED -e CONSOLE_URL=http://127.0.0.1:3000 -e APP_URL=http://127.0.0.1:3000 dify-web
    ```
3. 当控制台域名和 Web APP 域名不一致时，可单独设置 `CONSOLE_URL` 和 `APP_URL`
4. 本地访问 [http://127.0.0.1:3000](http://127.0.0.1:3000)

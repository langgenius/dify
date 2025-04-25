# Dify 后端 API

## 使用方法

> [重要事项]
> 
> 在 v1.3.0 版本中，`poetry` 已被
> [ `uv` ](https://docs.astral.sh/uv/) 替代，作为 Dify API 后端服务的包管理器。

1. 启动 docker-compose 栈

   后端需要一些中间件，包括 PostgreSQL、Redis 和 Weaviate，可以使用 `docker-compose` 一起启动。

   ```bash
   cd ../docker
   cp middleware.env.example middleware.env
   # 如果不使用 weaviate，请将配置文件更改为其他向量数据库
   docker compose -f docker-compose.middleware.yaml --profile weaviate -p dify up -d
   cd ../api
   ```

2. 将 `.env.example` 复制为 `.env`

   ```cli
   cp .env.example .env 
   ```
3. 在 `.env` 文件中生成一个 `SECRET_KEY`。

   Linux 系统的 bash 命令
   ```bash for Linux
   sed -i "/^SECRET_KEY=/c\SECRET_KEY=$(openssl rand -base64 42)" .env
   ```
   Mac 系统的 bash 命令
   ```bash for Mac
   secret_key=$(openssl rand -base64 42)
   sed -i '' "/^SECRET_KEY=/c\\
   SECRET_KEY=${secret_key}" .env
   ```

4. 创建环境。

   Dify API 服务使用 [UV](https://docs.astral.sh/uv/) 来管理依赖项。
   首先，如果还没有安装 uv 包管理器，需要先安装它。

   ```bash
   pip install uv
   # 或者在 macOS 上
   brew install uv
   ```

5. 安装依赖项

   ```bash
   uv sync --dev
   ```

6. 运行迁移

   在首次启动之前，将数据库迁移到最新版本。

   ```bash
   uv run flask db upgrade
   ```

7. 启动后端

   ```bash
   uv run flask run --host 0.0.0.0 --port=5001 --debug
   ```

8. 启动 Dify [web](../web) 服务。
9. 通过访问 `http://localhost:3000` 来设置你的应用程序。
10. 如果你需要处理和调试异步任务（例如数据集导入和文档索引），请启动工作进程服务。

   ```bash
   uv run celery -A app.celery worker -P gevent -c 1 --loglevel INFO -Q dataset,generation,mail,ops_trace,app_deletion
   ```

## 测试

1. 为后端和测试环境安装依赖项

   ```bash
   uv sync --dev
   ```

2. 使用 `pyproject.toml` 文件中 `tool.pytest_env` 部分模拟的系统环境变量在本地运行测试

   ```bash
   uv run -P api bash dev/pytest/pytest_all_tests.sh
   ```
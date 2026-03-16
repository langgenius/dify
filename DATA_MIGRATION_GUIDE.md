# Dify 数据备份与还原指南

由于本地的数据库和向量索引数据通常非常庞大（目前的备份文件大约 1GB），无法直接推送到 GitHub 仓库中，因此我们采用压缩包转移的方式进行数据迁移。

## 第一步：在原机器上备份数据
1. 关闭正在运行的 Dify 服务：
   ```bash
   cd dify/docker
   docker-compose down
   ```
2. 在 `dify` 根目录下，打包 `docker/volumes/` 目录（这一步已经帮您自动完成了）：
   ```bash
   cd dify
   tar -czvf dify_data_backup.tar.gz docker/volumes
   ```
3. 将生成的 `dify_data_backup.tar.gz` 文件通过 U 盘、网盘或内网传输等方式，拷贝到您的新机器上。

## 第二步：在新机器上还原数据
假设您已经在新机器上克隆了 `dify_demo_env` 仓库。

1. **解压备份文件**：
   将您拷贝过来的 `dify_data_backup.tar.gz` 放在新机器的 `dify` 项目根目录下，然后执行解压命令：
   ```bash
   cd dify
   # 这一步会自动将数据解压到 docker/volumes 目录下
   tar -xzvf dify_data_backup.tar.gz
   ```

2. **启动 Dify 服务**：
   解压完成后，`docker/volumes/` 里的所有数据库文件和文件缓存都已经就位了，您可以正常启动服务：
   ```bash
   cd dify/docker
   docker-compose up -d
   ```

3. **验证数据是否成功恢复**：
   启动成功后，访问 Dify 前端页面。您的所有本地知识库、对话记录、配置和用户数据，应该已经完好无损地迁移过来了。

> **提示**：在使用 `tar` 命令解包时如果遇到权限问题，请在命令前加上 `sudo`（例如 `sudo tar -xzvf ...`），确保新机器的 Docker 容器可以正确读取这些数据卷。

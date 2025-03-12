# 使用 CUDA 12.4.1 运行时镜像
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04 AS base

WORKDIR /app/api

# 替换 Ubuntu 官方源为阿里云源（适用于中国大陆用户）
RUN sed -i 's|http://archive.ubuntu.com/ubuntu/|http://mirrors.aliyun.com/ubuntu/|g' /etc/apt/sources.list \
    && apt-get update

# 安装 Python 3.12
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    tzdata software-properties-common curl wget gnupg \
    && ln -fs /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && dpkg-reconfigure --frontend noninteractive tzdata \
    && add-apt-repository ppa:deadsnakes/ppa -y || true \
    && apt-get update \
    && apt install -y libgomp1 \
    && apt install -y libcudnn8 libcudnn8-dev \
    && apt update && apt install -y software-properties-common \
    && wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.0-1_all.deb \
    && dpkg -i cuda-keyring_1.0-1_all.deb \
    && apt update \
    && apt install -y cuda-toolkit-12-0 \
    && apt-get install -y python3.12 python3.12-venv python3.12-dev python3.12-lib2to3 \
    && rm -rf /var/lib/apt/lists/*

# 确保 Python 3.12 作为默认 Python
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1 \
    && update-alternatives --set python3 /usr/bin/python3.12 \
    && python3 --version

# 让 Python 3.12 自带的 ensurepip 安装 pip
RUN python3.12 -m ensurepip --default-pip && python3.12 -m pip install --upgrade pip

# 确保 pip 可用
RUN python3 -m pip --version
# 安装 Poetry
ENV POETRY_VERSION=2.0.1

# 如果在中国，可以使用阿里云镜像加速
RUN python3 -m pip install --no-cache-dir poetry==${POETRY_VERSION} -i https://mirrors.aliyun.com/pypi/simple/

# 配置 Poetry
ENV POETRY_CACHE_DIR=/tmp/poetry_cache
ENV POETRY_NO_INTERACTION=1
ENV POETRY_VIRTUALENVS_IN_PROJECT=true
ENV POETRY_VIRTUALENVS_CREATE=true
ENV POETRY_REQUESTS_TIMEOUT=15

# ============ Packages Stage ============ #
FROM base AS packages

# 安装构建时需要的依赖
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ libc-dev libffi-dev libgmp-dev libmpfr-dev libmpc-dev

# 安装 Python 依赖
COPY pyproject.toml poetry.lock ./
RUN poetry install --sync --no-cache --no-root

# ============ Production Stage ============ #
FROM base AS production

ENV FLASK_APP=app.py
ENV EDITION=SELF_HOSTED
ENV DEPLOY_ENV=PRODUCTION
ENV CONSOLE_API_URL=http://127.0.0.1:5001
ENV CONSOLE_WEB_URL=http://127.0.0.1:3000
ENV SERVICE_API_URL=http://127.0.0.1:5001
ENV APP_WEB_URL=http://127.0.0.1:3000

EXPOSE 5001

# 设置时区
ENV TZ=UTC

WORKDIR /app/api

# 安装运行时所需的依赖
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl nodejs libgmp-dev libmpfr-dev libmpc-dev \
        expat libldap-2.5-0 perl libsqlite3-0 zlib1g \
        fonts-noto-cjk \
        media-types \
        libmagic1 \
        libgl1 \
        libglib2.0-0 \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# 复制 Python 运行环境和依赖
ENV VIRTUAL_ENV=/app/api/.venv
COPY --from=packages ${VIRTUAL_ENV} ${VIRTUAL_ENV}
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

# 下载 nltk 数据
RUN python -c "import nltk; nltk.download('punkt'); nltk.download('averaged_perceptron_tagger')"

# 处理 tiktoken 缓存
ENV TIKTOKEN_CACHE_DIR=/app/api/.tiktoken_cache
RUN python -c "import tiktoken; tiktoken.encoding_for_model('gpt2')"

# 复制源代码
COPY . /app/api/

# 复制并设置入口脚本
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ARG COMMIT_SHA
ENV COMMIT_SHA=${COMMIT_SHA}

ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]

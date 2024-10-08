#!/bin/bash

# 定义工作目录
BASE_DIR="/home/ruantong/dify"
CONDA_ENV="dify"

# 激活 Conda 环境
source /root/miniconda3/etc/profile.d/conda.sh
conda activate $CONDA_ENV

# 启动服务的函数
start_services() {
    echo "拉取最新的代码..."
    cd $BASE_DIR
    git pull

    # 启动Worker服务
    echo "启动Worker服务..."
    cd $BASE_DIR/api
    nohup celery -A app.celery worker -P gevent -c 1 -Q dataset,generation,mail,ops_trace --loglevel INFO > celery.log 2>&1 &

    # 启动后端服务
    echo "启动后端服务..."
    nohup flask run --host=0.0.0.0 --port=5001 --debug > journal.log 2>&1 &

    echo "启动前端服务..."
    cd $BASE_DIR/web
    nohup npm run dev > journal.log 2>&1 &

    # 提交本地代码至远程
    echo "提交本地代码至远程..."
    cd $BASE_DIR
    git add .
    git commit -m "测试提交"
    git push origin main

    echo "服务已启动!"
}

# 停止服务的函数
stop_services() {
    echo "停止服务..."
    # 杀掉 celery worker
    pkill -f 'celery -A app.celery worker'

    # 杀掉 Flask 服务
    pkill -f 'flask run'

    # 杀掉前端服务
    pkill -f 'npm run dev'

    echo "服务已停止!"
}

# 重启服务的函数
restart_services() {
    stop_services
    sleep 10
    start_services
}

# 查看服务状态的函数
status_services() {
    if pgrep -f 'celery -A app.celery worker' > /dev/null; then
        echo "Worker服务正在运行."
    else
        echo "Worker服务未运行."
    fi

    if pgrep -f 'flask run' > /dev/null; then
        echo "后端服务正在运行."
    else
        echo "后端服务未运行."
    fi

    if pgrep -f 'npm run dev' > /dev/null; then
        echo "前端服务正在运行."
    else
        echo "前端服务未运行."
    fi
}

echo "执行脚本的命令=$0 $1"

# 检查输入的命令
case "$1" in
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        restart_services
        ;;
    status)
        status_services
        ;;
    *)
        echo "使用方法: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac

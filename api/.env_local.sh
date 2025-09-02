source .venv/bin/activate

export DEPLOY_ENV=LOCAL
export SECRET_KEY=wQCFcazcnRz0P70KwnPHGE93Sq3Y+B3Xo51HZ4K+imEnlz41ihTLeJy7
export LOG_FILE=/home/will/work/dify/log/server.log

export DB_HOST=127.0.0.1
export DB_PORT=15432
export DB_DATABASE=difydb4
export DB_USERNAME=difyuser
export DB_PASSWORD=difyai123456

export REDIS_HOST=127.0.0.1
export REDIS_PORT=16379
export REDIS_DB=15
export REDIS_PASSWORD=redis_Test2021

export S3_ENDPOINT=http://10.19.61.41:8060
export S3_BUCKET_NAME=histaragent-dev-bucket
export S3_ACCESS_KEY=SE3DR56FCDA25GB8UQDW
export S3_SECRET_KEY=0MeTv0MjId9PKeDekRUF88gwXzhX1zMMDYNXUI5Y

export CELERY_WORKER_AMOUNT=1
export NUMEXPR_MAX_THREADS=4
export NUMEXPR_NUM_THREADS=2
export SERVER_WORKER_AMOUNT=2

export CODE_EXECUTION_ENDPOINT=http://127.0.0.1:8194

export PLUGIN_DAEMON_URL=http://localhost:15002
export PLUGIN_REMOTE_INSTALL_PORT=15003
export PLUGIN_REMOTE_INSTALL_HOST=localhost

# for docker compose
export DB_USER=difyuser
export DB_PLUGIN_DATABASE=dify_plugin

:<<EOF

gunicorn \
  --bind 0.0.0.0:5001 \
  --workers 4 \
  --worker-class gevent \
  --worker-connections 100 \
  --timeout 200 \
  --log-level=info \
  --access-logfile "-" \
  --access-logformat '%(t)s|%(p)s|%(h)s|%(r)s|status=%(s)s|request_len=%(b)s|response_len=%(B)s|time_used=%(L)s' \
  app:app

EOF

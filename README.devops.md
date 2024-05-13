## 相关组件
1. API
    Dify API service.
2. Worker
    Worker service, The Celery worker for processing the queue.
    All the config are same as API, only set MODE variable to "worker"
3. Web
    Frontend web application.
4. Weaviate
    The Weaviate vector store.

## Jenkins jobs
1. Web & API: 
    http://jenkins.ciandt.cn:8080/job/Others/job/Flow/job/others/job/devtool-apps/
    branch: dev, main
    apps: apps/cit-dify
2. Worker: 
    http://jenkins.ciandt.cn:8080/job/Others/job/Flow/job/others/job/devtool-apps/
    branch: worker
    apps: apps/cit-dify-worker
3. Weaviate
    http://jenkins.ciandt.cn:8080/job/Others/job/Flow/job/genaihub/job/devtool-core/
    branch: dev
    apps: apps/genaihub-weaviate

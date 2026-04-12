#!/bin/bash
# k8s/setup-k8s.sh
# Kubernetes 集群初始化脚本

set -e

NAMESPACE=${1:-dify}
DOCKER_REGISTRY_URL=${2:-ghcr.io}
DOCKER_USERNAME=${3:-your-username}
DOCKER_TOKEN=${4:-your-token}

echo "🚀 Setting up Kubernetes cluster for Dify"

# 1. 创建命名空间
echo "1️⃣  Creating namespace..."
kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

# 2. 创建镜像拉取密令
echo "2️⃣  Creating image pull secret..."
kubectl create secret docker-registry ghcr-secret \
  --docker-server=$DOCKER_REGISTRY_URL \
  --docker-username=$DOCKER_USERNAME \
  --docker-password=$DOCKER_TOKEN \
  --docker-email="ci@example.com" \
  -n $NAMESPACE \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. 验证连接
echo "3️⃣  Verifying Kubernetes connection..."
kubectl cluster-info
kubectl get nodes

# 4. 创建ConfigMap/Secret（如需要）
echo "4️⃣  Setting up ConfigMaps and Secrets..."

# 从环境文件创建Secret
if [ -f ".env.staging" ]; then
  kubectl create secret generic dify-env \
    --from-file=.env.staging \
    -n $NAMESPACE \
    --dry-run=client -o yaml | kubectl apply -f -
fi

# 5. 应用部署配置
echo "5️⃣  Applying deployment configuration..."
kubectl apply -f k8s/staging/deployment.yaml

# 6. 等待部署完成
echo "6️⃣  Waiting for deployment to complete..."
kubectl rollout status deployment/dify-api -n $NAMESPACE --timeout=5m
kubectl rollout status deployment/dify-web -n $NAMESPACE --timeout=5m

# 7. 显示状态
echo ""
echo "✅ Kubernetes setup completed!"
echo ""
echo "📊 Cluster Status:"
kubectl get nodes
echo ""
echo "🐳 Deployments:"
kubectl get deployments -n $NAMESPACE
echo ""
echo "📦 Pods:"
kubectl get pods -n $NAMESPACE
echo ""
echo "🔗 Services:"
kubectl get svc -n $NAMESPACE
echo ""
echo "💡 Next steps:"
echo "  - Check pod logs: kubectl logs -f deployment/dify-api -n $NAMESPACE"
echo "  - Port forward: kubectl port-forward svc/dify-web 3000:80 -n $NAMESPACE"
echo "  - Scale replicas: kubectl scale deployment/dify-api --replicas=3 -n $NAMESPACE"

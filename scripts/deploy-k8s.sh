#!/bin/bash
# scripts/deploy-k8s.sh
# Kubernetes 部署脚本

set -e

ENVIRONMENT=${1:-staging}
VERSION=${2:-develop}
NAMESPACE="dify"

echo "🚀 Deploying Dify to Kubernetes ($ENVIRONMENT, $VERSION)"

# 检查 kubectl
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found"
    exit 1
fi

# 检查 kube config
if [ ! -f "$HOME/.kube/config" ]; then
    echo "❌ Kubernetes config not found"
    exit 1
fi

# 检查命名空间
if ! kubectl get namespace $NAMESPACE >/dev/null 2>&1; then
    echo "📦 Creating namespace $NAMESPACE..."
    kubectl create namespace $NAMESPACE
fi

# 应用配置
echo "📋 Applying Kubernetes manifests..."
kubectl apply -f k8s/$ENVIRONMENT/ -n $NAMESPACE

# 更新镜像
echo "🔄 Updating images..."
BACKEND_IMAGE="ghcr.io/lczc1988/dify-api:$VERSION"
FRONTEND_IMAGE="ghcr.io/lczc1988/dify-web:$VERSION"

kubectl set image deployment/dify-api \
    api=$BACKEND_IMAGE \
    -n $NAMESPACE

kubectl set image deployment/dify-web \
    web=$FRONTEND_IMAGE \
    -n $NAMESPACE

# 等待部署完成
echo "⏳ Waiting for rollout..."
kubectl rollout status deployment/dify-api -n $NAMESPACE --timeout=5m
kubectl rollout status deployment/dify-web -n $NAMESPACE --timeout=5m

# 显示状态
echo "✅ Deployment completed"
echo ""
echo "📊 Service Status:"
kubectl get pods -n $NAMESPACE
echo ""
echo "🔗 Service URLs:"
kubectl get svc -n $NAMESPACE | grep -E "dify-web|dify-api"

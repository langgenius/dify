# Set the necessary environment variables
export DIFY_WEB_IMAGE_NAME="crdify.azurecr.io/langgenius/dify-web"
export DIFY_API_IMAGE_NAME="crdify.azurecr.io/langgenius/dify-api"

# Login to Azure Container Registry
az login
az acr login --name crdify

# Define the common build arguments
COMMIT_SHA=$(git rev-parse HEAD)
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)

# Build and push the web service
docker buildx create --use
docker buildx build \
    --platform linux/amd64 \
    --build-arg COMMIT_SHA=$COMMIT_SHA \
    --tag $DIFY_WEB_IMAGE_NAME:$COMMIT_SHA \
    --tag $DIFY_WEB_IMAGE_NAME:latest \
    --tag $DIFY_WEB_IMAGE_NAME:$BRANCH_NAME \
    --push web

# Build and push the api service
docker buildx build \
    --platform linux/amd64 \
    --build-arg COMMIT_SHA=$COMMIT_SHA \
    --tag $DIFY_API_IMAGE_NAME:$COMMIT_SHA \
    --tag $DIFY_API_IMAGE_NAME:latest \
    --tag $DIFY_API_IMAGE_NAME:$BRANCH_NAME \
    --push api
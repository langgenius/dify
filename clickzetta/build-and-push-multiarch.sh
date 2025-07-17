#!/bin/bash

# Build and push multi-architecture Docker images for ClickZetta Dify integration
# This provides temporary access to users before the PR is merged

set -e

# Configuration
DOCKER_HUB_USERNAME="czqiliang"
IMAGE_NAME="dify-clickzetta"
TAG="latest"
VERSION_TAG="v1.6.0"
PLATFORMS="linux/amd64,linux/arm64"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== ClickZetta Dify Multi-Architecture Build Script ===${NC}"
echo -e "${YELLOW}Building and pushing images for: ${PLATFORMS}${NC}"
echo -e "${YELLOW}Target repository: ${DOCKER_HUB_USERNAME}/${IMAGE_NAME}:${TAG}${NC}"
echo

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Check if buildx is available
if ! docker buildx version >/dev/null 2>&1; then
    echo -e "${RED}Error: Docker buildx is not available. Please ensure Docker Desktop is updated.${NC}"
    exit 1
fi

# Login to Docker Hub
echo -e "${BLUE}Step 1: Docker Hub Login${NC}"
if ! docker login; then
    echo -e "${RED}Error: Failed to login to Docker Hub${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Successfully logged in to Docker Hub${NC}"
echo

# Create and use buildx builder
echo -e "${BLUE}Step 2: Setting up buildx builder${NC}"
BUILDER_NAME="dify-clickzetta-builder"

# Remove existing builder if it exists
docker buildx rm $BUILDER_NAME 2>/dev/null || true

# Create new builder
docker buildx create --name $BUILDER_NAME --platform $PLATFORMS --use
docker buildx inspect --bootstrap

echo -e "${GREEN}✓ Buildx builder configured for platforms: ${PLATFORMS}${NC}"
echo

# Build and push API image
echo -e "${BLUE}Step 3: Building and pushing API image${NC}"
cd ../docker
docker buildx build \
    --platform $PLATFORMS \
    --file api.Dockerfile \
    --tag ${DOCKER_HUB_USERNAME}/${IMAGE_NAME}-api:${TAG} \
    --tag ${DOCKER_HUB_USERNAME}/${IMAGE_NAME}-api:${VERSION_TAG} \
    --tag ${DOCKER_HUB_USERNAME}/${IMAGE_NAME}-api:clickzetta-integration \
    --push \
    ..

echo -e "${GREEN}✓ API image built and pushed successfully${NC}"
echo

# Web service uses official Dify image (no ClickZetta-specific changes needed)
echo -e "${BLUE}Step 4: Web service uses official langgenius/dify-web image${NC}"
echo -e "${GREEN}✓ Web service configuration completed${NC}"
echo

# User files are already created in clickzetta/ directory
echo -e "${BLUE}Step 5: User files already prepared in clickzetta/ directory${NC}"
cd ../clickzetta

echo -e "${GREEN}✓ User files available in clickzetta/ directory${NC}"
echo

# Cleanup buildx builder
echo -e "${BLUE}Step 6: Cleaning up builder${NC}"
docker buildx rm $BUILDER_NAME
echo -e "${GREEN}✓ Builder cleaned up${NC}"
echo

# Display final information
echo -e "${GREEN}=== Build Complete! ===${NC}"
echo -e "${YELLOW}ClickZetta API images pushed to Docker Hub:${NC}"
echo -e "  • ${DOCKER_HUB_USERNAME}/${IMAGE_NAME}-api:${TAG}"
echo -e "  • ${DOCKER_HUB_USERNAME}/${IMAGE_NAME}-api:${VERSION_TAG}"
echo -e "  • ${DOCKER_HUB_USERNAME}/${IMAGE_NAME}-api:clickzetta-integration"
echo
echo -e "${YELLOW}Web service uses official Dify image:${NC}"
echo -e "  • langgenius/dify-web:1.6.0 (no ClickZetta changes needed)"
echo
echo -e "${YELLOW}User files created:${NC}"
echo -e "  • docker-compose.clickzetta.yml - Ready-to-use compose file"
echo -e "  • .env.clickzetta.example - Environment template"
echo -e "  • README.clickzetta.md - User documentation"
echo
echo -e "${BLUE}Next steps:${NC}"
echo -e "1. Test the images locally"
echo -e "2. Update README with Docker Hub links"
echo -e "3. Share with community for testing"
echo -e "4. Monitor for feedback and issues"
echo
echo -e "${GREEN}🎉 Multi-architecture images are now available for the community!${NC}"
# Variables
DOCKER_REGISTRY=langgenius
WEB_IMAGE=$(DOCKER_REGISTRY)/dify-web
API_IMAGE=$(DOCKER_REGISTRY)/dify-api
VERSION=latest

up-middleware:
	docker-compose -f docker/docker-compose.middleware.yaml up -d

down-middleware:
	docker-compose -f docker/docker-compose.middleware.yaml down

logs-middleware:
	docker-compose -f docker/docker-compose.middleware.yaml logs -f

# start the application
start-front:
	@echo "Running web Docker container..."
	docker rm dify-web
	docker run --name dify-web -p 3000:3000 $(WEB_IMAGE):$(VERSION)
	@echo "Web Docker container started successfully."

start-backend:
	@echo "Running API Docker container..."
	docker rm dify-api
	docker run --name dify-api --env-file ./api/.env -p 5001:5001 $(API_IMAGE):$(VERSION)
	@echo "API Docker container started successfully."

# ...
# Build Docker images
build-web:
	@echo "Building web Docker image: $(WEB_IMAGE):$(VERSION)..."
	docker build -t $(WEB_IMAGE):$(VERSION) ./web
	@echo "Web Docker image built successfully: $(WEB_IMAGE):$(VERSION)"

build-api:
	@echo "Building API Docker image: $(API_IMAGE):$(VERSION)..."
	docker build -t $(API_IMAGE):$(VERSION) ./api
	@echo "API Docker image built successfully: $(API_IMAGE):$(VERSION)"

# Push Docker images
push-web:
	@echo "Pushing web Docker image: $(WEB_IMAGE):$(VERSION)..."
	docker push $(WEB_IMAGE):$(VERSION)
	@echo "Web Docker image pushed successfully: $(WEB_IMAGE):$(VERSION)"

push-api:
	@echo "Pushing API Docker image: $(API_IMAGE):$(VERSION)..."
	docker push $(API_IMAGE):$(VERSION)
	@echo "API Docker image pushed successfully: $(API_IMAGE):$(VERSION)"

# Build all images
build-all: build-web build-api

# Push all images
push-all: push-web push-api

build-push-api: build-api push-api
build-push-web: build-web push-web

# Build and push all images
build-push-all: build-all push-all
	@echo "All Docker images have been built and pushed."

# Phony targets
.PHONY: build-web build-api push-web push-api build-all push-all build-push-all

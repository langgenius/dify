#!/bin/bash

mkdir -p bin

echo "Building for Linux (amd64)..."
GOOS=linux GOARCH=amd64 go build -o bin/evaluate-code-linux ./cmd/

echo "Building for macOS (amd64)..."
GOOS=darwin GOARCH=amd64 go build -o bin/evaluate-code-mac ./cmd/

echo "Building for macOS (arm64)..."
GOOS=darwin GOARCH=arm64 go build -o bin/evaluate-code-mac-arm64 ./cmd/

echo "Building for Windows (amd64)..."
GOOS=windows GOARCH=amd64 go build -o bin/evaluate-code.exe ./cmd/

echo "Build complete! Binaries are in the bin directory."
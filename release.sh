#!/usr/bin/env bash
set -e
# Build Docker image with version from package.json
VERSION=$(node -p "require('./package.json').version")
IMAGE_NAME="yourdockerhubuser/wa-akg:${VERSION}"
# Build the image
docker build -t $IMAGE_NAME .
# Push to Docker Hub (login required)
docker push $IMAGE_NAME
# Optionally tag latest
docker tag $IMAGE_NAME "yourdockerhubuser/wa-akg:latest"
docker push "yourdockerhubuser/wa-akg:latest"

echo "Docker image $IMAGE_NAME built and pushed."

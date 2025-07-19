#!/bin/bash
# Docker build script for Resume Tailor Backend

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="resume-tailor-backend"
VERSION=${1:-latest}
REGISTRY=${DOCKER_REGISTRY:-}

echo -e "${GREEN}Building Resume Tailor Backend Docker image...${NC}"

# Build the image
echo -e "${YELLOW}Building image: ${IMAGE_NAME}:${VERSION}${NC}"
docker build -t ${IMAGE_NAME}:${VERSION} .

# Tag for registry if specified
if [ ! -z "$REGISTRY" ]; then
    echo -e "${YELLOW}Tagging for registry: ${REGISTRY}/${IMAGE_NAME}:${VERSION}${NC}"
    docker tag ${IMAGE_NAME}:${VERSION} ${REGISTRY}/${IMAGE_NAME}:${VERSION}
    docker tag ${IMAGE_NAME}:${VERSION} ${REGISTRY}/${IMAGE_NAME}:latest
fi

# Show image info
echo -e "${GREEN}Build completed successfully!${NC}"
docker images | grep ${IMAGE_NAME}

# Optional: Run security scan
if command -v docker-scout &> /dev/null; then
    echo -e "${YELLOW}Running security scan...${NC}"
    docker scout cves ${IMAGE_NAME}:${VERSION}
fi

echo -e "${GREEN}Docker build script completed!${NC}"
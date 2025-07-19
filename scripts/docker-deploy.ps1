# PowerShell script for Docker deployment on Windows
# Resume Tailor Backend Docker Deployment

param(
    [string]$Environment = "development",
    [string]$Version = "latest",
    [switch]$Build = $false,
    [switch]$Clean = $false
)

# Colors for output
$Green = "Green"
$Yellow = "Yellow"
$Red = "Red"

Write-Host "Resume Tailor Backend Docker Deployment" -ForegroundColor $Green
Write-Host "Environment: $Environment" -ForegroundColor $Yellow
Write-Host "Version: $Version" -ForegroundColor $Yellow

# Clean up if requested
if ($Clean) {
    Write-Host "Cleaning up existing containers and images..." -ForegroundColor $Yellow
    docker-compose down --volumes --remove-orphans
    docker system prune -f
}

# Build image if requested
if ($Build) {
    Write-Host "Building Docker image..." -ForegroundColor $Yellow
    docker build -t resume-tailor-backend:$Version .
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Docker build failed!" -ForegroundColor $Red
        exit 1
    }
}

# Deploy based on environment
switch ($Environment) {
    "development" {
        Write-Host "Starting development environment..." -ForegroundColor $Green
        docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
    }
    "production" {
        Write-Host "Starting production environment..." -ForegroundColor $Green
        docker-compose --profile production up -d
    }
    default {
        Write-Host "Starting default environment..." -ForegroundColor $Green
        docker-compose up -d
    }
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "Deployment completed successfully!" -ForegroundColor $Green
    Write-Host "Checking service status..." -ForegroundColor $Yellow
    docker-compose ps
} else {
    Write-Host "Deployment failed!" -ForegroundColor $Red
    exit 1
}
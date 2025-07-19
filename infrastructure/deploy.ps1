# PowerShell AWS Deployment Script for Resume Tailor Backend

param(
    [string]$Environment = "prod",
    [string]$AwsRegion = "us-east-1",
    [switch]$SkipBuild = $false,
    [switch]$PlanOnly = $false
)

# Colors for output
$Green = "Green"
$Yellow = "Yellow"
$Red = "Red"
$Blue = "Cyan"

Write-Host "Resume Tailor Backend AWS Deployment" -ForegroundColor $Green
Write-Host "Environment: $Environment" -ForegroundColor $Blue
Write-Host "AWS Region: $AwsRegion" -ForegroundColor $Blue

# Check prerequisites
function Test-Prerequisites {
    Write-Host "Checking prerequisites..." -ForegroundColor $Yellow
    
    # Check if AWS CLI is installed
    if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
        Write-Host "AWS CLI is not installed. Please install it first." -ForegroundColor $Red
        exit 1
    }
    
    # Check if Terraform is installed
    if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
        Write-Host "Terraform is not installed. Please install it first." -ForegroundColor $Red
        exit 1
    }
    
    # Check if Docker is installed
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Host "Docker is not installed. Please install it first." -ForegroundColor $Red
        exit 1
    }
    
    # Check AWS credentials
    try {
        aws sts get-caller-identity | Out-Null
    }
    catch {
        Write-Host "AWS credentials not configured. Please run 'aws configure'." -ForegroundColor $Red
        exit 1
    }
    
    Write-Host "✓ Prerequisites check passed" -ForegroundColor $Green
}

# Setup Terraform backend
function Initialize-TerraformBackend {
    Write-Host "Setting up Terraform backend..." -ForegroundColor $Yellow
    
    $AccountId = (aws sts get-caller-identity --query Account --output text)
    $BucketName = "resume-tailor-terraform-state-$AccountId-$AwsRegion"
    
    # Create S3 bucket for Terraform state
    try {
        aws s3 ls "s3://$BucketName" 2>$null | Out-Null
    }
    catch {
        Write-Host "Creating Terraform state bucket: $BucketName" -ForegroundColor $Blue
        aws s3 mb "s3://$BucketName" --region $AwsRegion
        
        # Enable versioning
        aws s3api put-bucket-versioning --bucket $BucketName --versioning-configuration Status=Enabled
        
        # Enable server-side encryption
        $EncryptionConfig = @{
            Rules = @(
                @{
                    ApplyServerSideEncryptionByDefault = @{
                        SSEAlgorithm = "AES256"
                    }
                }
            )
        } | ConvertTo-Json -Depth 3
        
        aws s3api put-bucket-encryption --bucket $BucketName --server-side-encryption-configuration $EncryptionConfig
    }
    
    # Create DynamoDB table for state locking
    $TableName = "resume-tailor-terraform-locks"
    try {
        aws dynamodb describe-table --table-name $TableName --region $AwsRegion | Out-Null
    }
    catch {
        Write-Host "Creating DynamoDB table for state locking: $TableName" -ForegroundColor $Blue
        aws dynamodb create-table `
            --table-name $TableName `
            --attribute-definitions AttributeName=LockID,AttributeType=S `
            --key-schema AttributeName=LockID,KeyType=HASH `
            --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 `
            --region $AwsRegion
        
        # Wait for table to be active
        aws dynamodb wait table-exists --table-name $TableName --region $AwsRegion
    }
    
    # Create backend configuration
    $BackendConfig = @"
terraform {
  backend "s3" {
    bucket         = "$BucketName"
    key            = "resume-tailor/$Environment/terraform.tfstate"
    region         = "$AwsRegion"
    dynamodb_table = "$TableName"
    encrypt        = true
  }
}
"@
    
    $BackendConfig | Out-File -FilePath "terraform/backend.tf" -Encoding UTF8
    
    Write-Host "✓ Terraform backend configured" -ForegroundColor $Green
}

# Build and push Docker image to ECR
function Build-AndPushImage {
    if ($SkipBuild) {
        Write-Host "Skipping Docker build as requested" -ForegroundColor $Yellow
        return
    }
    
    Write-Host "Building and pushing Docker image..." -ForegroundColor $Yellow
    
    $AccountId = (aws sts get-caller-identity --query Account --output text)
    $EcrRepository = "resume-tailor-backend"
    $EcrUri = "$AccountId.dkr.ecr.$AwsRegion.amazonaws.com/$EcrRepository"
    
    # Create ECR repository if it doesn't exist
    try {
        aws ecr describe-repositories --repository-names $EcrRepository --region $AwsRegion | Out-Null
    }
    catch {
        Write-Host "Creating ECR repository: $EcrRepository" -ForegroundColor $Blue
        aws ecr create-repository --repository-name $EcrRepository --region $AwsRegion --image-scanning-configuration scanOnPush=true
    }
    
    # Get ECR login token
    $LoginToken = aws ecr get-login-password --region $AwsRegion
    $LoginToken | docker login --username AWS --password-stdin $EcrUri
    
    # Build Docker image
    Write-Host "Building Docker image..." -ForegroundColor $Blue
    Set-Location ..
    docker build -t "${EcrRepository}:latest" .
    docker tag "${EcrRepository}:latest" "${EcrUri}:latest"
    docker tag "${EcrRepository}:latest" "${EcrUri}:$Environment"
    
    # Push to ECR
    Write-Host "Pushing Docker image to ECR..." -ForegroundColor $Blue
    docker push "${EcrUri}:latest"
    docker push "${EcrUri}:$Environment"
    
    Set-Location infrastructure
    Write-Host "✓ Docker image built and pushed" -ForegroundColor $Green
}

# Deploy infrastructure with Terraform
function Deploy-Infrastructure {
    Write-Host "Deploying infrastructure with Terraform..." -ForegroundColor $Yellow
    
    Set-Location terraform
    
    # Initialize Terraform
    Write-Host "Initializing Terraform..." -ForegroundColor $Blue
    terraform init
    
    # Validate configuration
    Write-Host "Validating Terraform configuration..." -ForegroundColor $Blue
    terraform validate
    
    # Plan deployment
    Write-Host "Planning Terraform deployment..." -ForegroundColor $Blue
    terraform plan -var-file="terraform.tfvars" -out="tfplan"
    
    if ($PlanOnly) {
        Write-Host "Plan-only mode: Skipping apply" -ForegroundColor $Yellow
        Set-Location ..
        return
    }
    
    # Apply deployment
    Write-Host "Applying Terraform deployment..." -ForegroundColor $Blue
    terraform apply "tfplan"
    
    # Output important information
    Write-Host "✓ Infrastructure deployed successfully" -ForegroundColor $Green
    Write-Host "Important outputs:" -ForegroundColor $Yellow
    terraform output
    
    Set-Location ..
}

# Update application secrets
function Update-Secrets {
    Write-Host "Updating application secrets..." -ForegroundColor $Yellow
    
    # Get secret ARN from Terraform output
    Set-Location terraform
    $AppSecretArn = terraform output -raw app_secrets_arn
    Set-Location ..
    
    Write-Host "Please update the application secrets in AWS Secrets Manager:" -ForegroundColor $Blue
    Write-Host "Secret ARN: $AppSecretArn" -ForegroundColor $Blue
    Write-Host "You can update it using the AWS Console or CLI" -ForegroundColor $Blue
    
    # Optionally open AWS Console
    $ConsoleUrl = "https://$AwsRegion.console.aws.amazon.com/secretsmanager/home?region=$AwsRegion#!/secret?name=$($AppSecretArn.Split('/')[-1])"
    Write-Host "AWS Console URL: $ConsoleUrl" -ForegroundColor $Blue
    
    # Ask if user wants to open browser
    $OpenBrowser = Read-Host "Open AWS Secrets Manager in browser? (y/N)"
    if ($OpenBrowser -eq 'y' -or $OpenBrowser -eq 'Y') {
        Start-Process $ConsoleUrl
    }
}

# Main deployment function
function Start-Deployment {
    Write-Host "Starting Resume Tailor Backend deployment..." -ForegroundColor $Green
    
    Test-Prerequisites
    Initialize-TerraformBackend
    Build-AndPushImage
    Deploy-Infrastructure
    
    if (-not $PlanOnly) {
        Update-Secrets
        
        Write-Host "🎉 Deployment completed successfully!" -ForegroundColor $Green
        Write-Host "Next steps:" -ForegroundColor $Yellow
        Write-Host "1. Update application secrets in AWS Secrets Manager" -ForegroundColor $Blue
        Write-Host "2. Configure your domain DNS to point to the load balancer" -ForegroundColor $Blue
        Write-Host "3. Test the application health endpoint" -ForegroundColor $Blue
        Write-Host "4. Monitor the CloudWatch dashboard" -ForegroundColor $Blue
    }
}

# Run main function
try {
    Start-Deployment
}
catch {
    Write-Host "Deployment failed: $($_.Exception.Message)" -ForegroundColor $Red
    exit 1
}
#!/bin/bash
# AWS Deployment Script for Resume Tailor Backend

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-prod}
AWS_REGION=${2:-us-east-1}
TERRAFORM_DIR="terraform"

echo -e "${GREEN}Resume Tailor Backend AWS Deployment${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}AWS Region: ${AWS_REGION}${NC}"

# Check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"
    
    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        echo -e "${RED}AWS CLI is not installed. Please install it first.${NC}"
        exit 1
    fi
    
    # Check if Terraform is installed
    if ! command -v terraform &> /dev/null; then
        echo -e "${RED}Terraform is not installed. Please install it first.${NC}"
        exit 1
    fi
    
    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Docker is not installed. Please install it first.${NC}"
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        echo -e "${RED}AWS credentials not configured. Please run 'aws configure'.${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Prerequisites check passed${NC}"
}

# Setup Terraform backend
setup_terraform_backend() {
    echo -e "${YELLOW}Setting up Terraform backend...${NC}"
    
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    BUCKET_NAME="resume-tailor-terraform-state-${ACCOUNT_ID}-${AWS_REGION}"
    
    # Create S3 bucket for Terraform state
    if ! aws s3 ls "s3://${BUCKET_NAME}" 2>&1 | grep -q 'NoSuchBucket'; then
        echo -e "${BLUE}Creating Terraform state bucket: ${BUCKET_NAME}${NC}"
        aws s3 mb "s3://${BUCKET_NAME}" --region "${AWS_REGION}"
        
        # Enable versioning
        aws s3api put-bucket-versioning \
            --bucket "${BUCKET_NAME}" \
            --versioning-configuration Status=Enabled
        
        # Enable server-side encryption
        aws s3api put-bucket-encryption \
            --bucket "${BUCKET_NAME}" \
            --server-side-encryption-configuration '{
                "Rules": [
                    {
                        "ApplyServerSideEncryptionByDefault": {
                            "SSEAlgorithm": "AES256"
                        }
                    }
                ]
            }'
    fi
    
    # Create DynamoDB table for state locking
    TABLE_NAME="resume-tailor-terraform-locks"
    if ! aws dynamodb describe-table --table-name "${TABLE_NAME}" --region "${AWS_REGION}" &> /dev/null; then
        echo -e "${BLUE}Creating DynamoDB table for state locking: ${TABLE_NAME}${NC}"
        aws dynamodb create-table \
            --table-name "${TABLE_NAME}" \
            --attribute-definitions AttributeName=LockID,AttributeType=S \
            --key-schema AttributeName=LockID,KeyType=HASH \
            --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
            --region "${AWS_REGION}"
        
        # Wait for table to be active
        aws dynamodb wait table-exists --table-name "${TABLE_NAME}" --region "${AWS_REGION}"
    fi
    
    # Create backend configuration
    cat > "${TERRAFORM_DIR}/backend.tf" << EOF
terraform {
  backend "s3" {
    bucket         = "${BUCKET_NAME}"
    key            = "resume-tailor/${ENVIRONMENT}/terraform.tfstate"
    region         = "${AWS_REGION}"
    dynamodb_table = "${TABLE_NAME}"
    encrypt        = true
  }
}
EOF
    
    echo -e "${GREEN}✓ Terraform backend configured${NC}"
}

# Build and push Docker image to ECR
build_and_push_image() {
    echo -e "${YELLOW}Building and pushing Docker image...${NC}"
    
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    ECR_REPOSITORY="resume-tailor-backend"
    ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY}"
    
    # Create ECR repository if it doesn't exist
    if ! aws ecr describe-repositories --repository-names "${ECR_REPOSITORY}" --region "${AWS_REGION}" &> /dev/null; then
        echo -e "${BLUE}Creating ECR repository: ${ECR_REPOSITORY}${NC}"
        aws ecr create-repository \
            --repository-name "${ECR_REPOSITORY}" \
            --region "${AWS_REGION}" \
            --image-scanning-configuration scanOnPush=true
    fi
    
    # Get ECR login token
    aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_URI}"
    
    # Build Docker image
    echo -e "${BLUE}Building Docker image...${NC}"
    cd ..
    docker build -t "${ECR_REPOSITORY}:latest" .
    docker tag "${ECR_REPOSITORY}:latest" "${ECR_URI}:latest"
    docker tag "${ECR_REPOSITORY}:latest" "${ECR_URI}:${ENVIRONMENT}"
    
    # Push to ECR
    echo -e "${BLUE}Pushing Docker image to ECR...${NC}"
    docker push "${ECR_URI}:latest"
    docker push "${ECR_URI}:${ENVIRONMENT}"
    
    cd infrastructure
    echo -e "${GREEN}✓ Docker image built and pushed${NC}"
}

# Deploy infrastructure with Terraform
deploy_infrastructure() {
    echo -e "${YELLOW}Deploying infrastructure with Terraform...${NC}"
    
    cd "${TERRAFORM_DIR}"
    
    # Initialize Terraform
    echo -e "${BLUE}Initializing Terraform...${NC}"
    terraform init
    
    # Validate configuration
    echo -e "${BLUE}Validating Terraform configuration...${NC}"
    terraform validate
    
    # Plan deployment
    echo -e "${BLUE}Planning Terraform deployment...${NC}"
    terraform plan -var-file="terraform.tfvars" -out="tfplan"
    
    # Apply deployment
    echo -e "${BLUE}Applying Terraform deployment...${NC}"
    terraform apply "tfplan"
    
    # Output important information
    echo -e "${GREEN}✓ Infrastructure deployed successfully${NC}"
    echo -e "${YELLOW}Important outputs:${NC}"
    terraform output
    
    cd ..
}

# Update application secrets
update_secrets() {
    echo -e "${YELLOW}Updating application secrets...${NC}"
    
    # Get secret ARN from Terraform output
    cd "${TERRAFORM_DIR}"
    APP_SECRET_ARN=$(terraform output -raw app_secrets_arn)
    cd ..
    
    echo -e "${BLUE}Please update the application secrets in AWS Secrets Manager:${NC}"
    echo -e "${BLUE}Secret ARN: ${APP_SECRET_ARN}${NC}"
    echo -e "${BLUE}You can update it using the AWS Console or CLI${NC}"
    
    # Optionally open AWS Console
    if command -v open &> /dev/null; then
        echo -e "${YELLOW}Opening AWS Secrets Manager in browser...${NC}"
        open "https://${AWS_REGION}.console.aws.amazon.com/secretsmanager/home?region=${AWS_REGION}#!/secret?name=${APP_SECRET_ARN##*/}"
    fi
}

# Main deployment function
main() {
    echo -e "${GREEN}Starting Resume Tailor Backend deployment...${NC}"
    
    check_prerequisites
    setup_terraform_backend
    build_and_push_image
    deploy_infrastructure
    update_secrets
    
    echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
    echo -e "${YELLOW}Next steps:${NC}"
    echo -e "${BLUE}1. Update application secrets in AWS Secrets Manager${NC}"
    echo -e "${BLUE}2. Configure your domain DNS to point to the load balancer${NC}"
    echo -e "${BLUE}3. Test the application health endpoint${NC}"
    echo -e "${BLUE}4. Monitor the CloudWatch dashboard${NC}"
}

# Run main function
main
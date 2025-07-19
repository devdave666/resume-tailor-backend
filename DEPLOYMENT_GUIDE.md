# AWS Deployment Guide

This guide covers the complete deployment of the Resume Tailor Backend to AWS using Terraform Infrastructure as Code.

## Prerequisites

### Required Tools

1. **AWS CLI v2**
   ```bash
   # Install AWS CLI
   curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
   unzip awscliv2.zip
   sudo ./aws/install
   
   # Configure AWS credentials
   aws configure
   ```

2. **Terraform >= 1.0**
   ```bash
   # Install Terraform
   wget https://releases.hashicorp.com/terraform/1.6.0/terraform_1.6.0_linux_amd64.zip
   unzip terraform_1.6.0_linux_amd64.zip
   sudo mv terraform /usr/local/bin/
   ```

3. **Docker**
   ```bash
   # Install Docker
   curl -fsSL https://get.docker.com -o get-docker.sh
   sh get-docker.sh
   sudo usermod -aG docker $USER
   ```

### AWS Account Setup

1. **AWS Account**: Active AWS account with billing enabled
2. **IAM Permissions**: Administrator access or specific permissions for:
   - EC2, VPC, ELB, Auto Scaling
   - RDS, ElastiCache
   - S3, CloudWatch, Secrets Manager
   - IAM roles and policies

3. **Domain (Optional)**: Registered domain for custom URL
4. **SSL Certificate (Optional)**: ACM certificate for HTTPS

## Quick Deployment

### 1. Configure Environment

```bash
# Clone and navigate to infrastructure directory
cd infrastructure

# Copy and customize Terraform variables
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# Edit terraform.tfvars with your specific values
```

### 2. Deploy Infrastructure

**Linux/Mac:**
```bash
# Make script executable
chmod +x deploy.sh

# Deploy to production
./deploy.sh prod us-east-1
```

**Windows PowerShell:**
```powershell
# Deploy to production
.\deploy.ps1 -Environment prod -AwsRegion us-east-1
```

### 3. Update Application Secrets

After deployment, update the application secrets in AWS Secrets Manager with your actual API keys:

- `GEMINI_API_KEY`: Your Google Gemini API key
- `STRIPE_SECRET_KEY`: Your Stripe secret key
- `STRIPE_WEBHOOK_SECRET`: Your Stripe webhook secret
- `JWT_SECRET`: Strong random string for JWT signing
- `PDF_CO_API_KEY`: Your PDF.co API key (if used)

## Manual Deployment Steps

### 1. Setup Terraform Backend

```bash
cd infrastructure/terraform

# Initialize Terraform
terraform init

# Create backend configuration (done automatically by deploy script)
```

### 2. Configure Variables

Edit `terraform/terraform.tfvars`:

```hcl
# Basic Configuration
project_name = "resume-tailor"
environment  = "prod"
aws_region   = "us-east-1"

# Instance Configuration
instance_type    = "t3.medium"
min_size         = 2
max_size         = 10
desired_capacity = 2

# Database Configuration
db_instance_class = "db.t3.micro"
db_name          = "resume_tailor"
db_username      = "postgres"

# Domain Configuration (optional)
domain_name     = "api.your-domain.com"
certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/..."

# Security
ssh_key_name = "your-ec2-key-pair"
```

### 3. Plan and Apply Infrastructure

```bash
# Validate configuration
terraform validate

# Plan deployment
terraform plan -var-file="terraform.tfvars"

# Apply deployment
terraform apply -var-file="terraform.tfvars"
```

### 4. Build and Deploy Application

```bash
# Build Docker image
docker build -t resume-tailor-backend:latest ..

# Tag for ECR
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com/resume-tailor-backend"
docker tag resume-tailor-backend:latest ${ECR_URI}:latest

# Push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ${ECR_URI}
docker push ${ECR_URI}:latest
```

## Infrastructure Components

### Network Architecture

- **VPC**: Isolated network with public, private, and database subnets
- **Internet Gateway**: Internet access for public subnets
- **NAT Gateways**: Outbound internet access for private subnets
- **Route Tables**: Traffic routing configuration

### Compute Resources

- **Application Load Balancer**: Distributes traffic across EC2 instances
- **Auto Scaling Group**: Automatically scales EC2 instances based on demand
- **Launch Template**: Defines EC2 instance configuration
- **Security Groups**: Network-level firewall rules

### Database and Storage

- **RDS PostgreSQL**: Managed database with automated backups
- **ElastiCache Redis**: In-memory caching and session storage
- **S3 Buckets**: File storage and application logs
- **Secrets Manager**: Secure storage for sensitive configuration

### Monitoring and Logging

- **CloudWatch**: Metrics, logs, and alarms
- **CloudWatch Dashboard**: Visual monitoring interface
- **Auto Scaling Policies**: CPU-based scaling triggers
- **Health Checks**: Application and infrastructure monitoring

## Configuration Management

### Environment Variables

The application uses environment variables for configuration:

```bash
# Database
DB_HOST=your-rds-endpoint
DB_PORT=5432
DB_NAME=resume_tailor
DB_USER=postgres
DB_PASSWORD=from-secrets-manager

# Redis
REDIS_HOST=your-elasticache-endpoint
REDIS_PORT=6379

# Application
NODE_ENV=production
PORT=3000
JWT_SECRET=from-secrets-manager

# External APIs
GEMINI_API_KEY=from-secrets-manager
STRIPE_SECRET_KEY=from-secrets-manager
```

### Secrets Management

Sensitive values are stored in AWS Secrets Manager:

1. **Database Password**: Auto-generated and stored securely
2. **Application Secrets**: API keys and JWT secret
3. **Automatic Rotation**: Can be configured for enhanced security

## Monitoring and Maintenance

### CloudWatch Monitoring

- **Application Metrics**: Request count, response time, error rates
- **Infrastructure Metrics**: CPU, memory, disk usage
- **Database Metrics**: Connection count, query performance
- **Custom Alarms**: Automated alerts for critical issues

### Log Management

- **Application Logs**: Centralized in CloudWatch Logs
- **Access Logs**: Load balancer access patterns
- **System Logs**: EC2 instance system events
- **Log Retention**: Configurable retention periods

### Backup and Recovery

- **Database Backups**: Automated daily backups with point-in-time recovery
- **Configuration Backups**: Terraform state stored in S3
- **Disaster Recovery**: Multi-AZ deployment for high availability

## Security Features

### Network Security

- **Private Subnets**: Application servers not directly accessible from internet
- **Security Groups**: Restrictive firewall rules
- **NACLs**: Additional network-level security
- **VPC Flow Logs**: Network traffic monitoring

### Data Security

- **Encryption at Rest**: All storage encrypted
- **Encryption in Transit**: HTTPS/TLS for all communications
- **Secrets Management**: No hardcoded credentials
- **IAM Roles**: Least privilege access principles

### Application Security

- **Security Headers**: Implemented in load balancer and application
- **Rate Limiting**: Protection against abuse
- **Input Validation**: Comprehensive request validation
- **Authentication**: JWT-based user authentication

## Scaling and Performance

### Auto Scaling

- **Horizontal Scaling**: Automatic EC2 instance scaling
- **Database Scaling**: Read replicas for production
- **Cache Scaling**: Redis cluster for high availability
- **Load Balancing**: Traffic distribution across instances

### Performance Optimization

- **CDN Integration**: CloudFlare for static content
- **Database Optimization**: Connection pooling and query optimization
- **Caching Strategy**: Redis for session and application caching
- **Compression**: Gzip compression for responses

## Cost Optimization

### Resource Sizing

- **Right-sizing**: Appropriate instance types for workload
- **Reserved Instances**: Cost savings for predictable workloads
- **Spot Instances**: Cost-effective for non-critical workloads
- **Storage Optimization**: Lifecycle policies for S3 storage

### Monitoring Costs

- **Cost Alerts**: Automated notifications for budget thresholds
- **Resource Tagging**: Detailed cost allocation
- **Usage Monitoring**: Regular review of resource utilization
- **Optimization Recommendations**: AWS Cost Explorer insights

## Troubleshooting

### Common Issues

1. **Deployment Failures**
   ```bash
   # Check Terraform logs
   terraform plan -detailed-exitcode
   
   # Validate configuration
   terraform validate
   ```

2. **Application Health Issues**
   ```bash
   # Check application logs
   aws logs tail /aws/ec2/resume-tailor-prod --follow
   
   # Check load balancer health
   aws elbv2 describe-target-health --target-group-arn <target-group-arn>
   ```

3. **Database Connection Issues**
   ```bash
   # Check RDS status
   aws rds describe-db-instances --db-instance-identifier resume-tailor-prod-db
   
   # Check security groups
   aws ec2 describe-security-groups --group-ids <security-group-id>
   ```

### Support Resources

- **AWS Documentation**: Comprehensive service documentation
- **Terraform Documentation**: Infrastructure as Code best practices
- **CloudWatch Dashboards**: Real-time monitoring and alerting
- **AWS Support**: Professional support for production workloads

## Next Steps

After successful deployment:

1. **Configure DNS**: Point your domain to the load balancer
2. **Setup Monitoring**: Configure additional CloudWatch alarms
3. **Performance Testing**: Load test the application
4. **Security Audit**: Conduct security assessment
5. **Backup Testing**: Verify backup and recovery procedures
6. **Documentation**: Update operational procedures

This deployment provides a production-ready, scalable, and secure infrastructure for the Resume Tailor Backend application.
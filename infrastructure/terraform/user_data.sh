#!/bin/bash
# User Data Script for Resume Tailor Backend EC2 Instances

set -e

# Update system
yum update -y

# Install Docker
amazon-linux-extras install docker -y
systemctl start docker
systemctl enable docker
usermod -a -G docker ec2-user

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Install CloudWatch agent
yum install -y amazon-cloudwatch-agent

# Install AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
./aws/install

# Create application directory
mkdir -p /opt/resume-tailor
cd /opt/resume-tailor

# Create environment file from Secrets Manager
cat > .env << EOF
NODE_ENV=${environment}
PORT=${app_port}
DB_HOST=${db_host}
DB_PORT=5432
DB_NAME=${db_name}
DB_USER=${db_username}
REDIS_HOST=${redis_host}
REDIS_PORT=6379
AWS_REGION=${secrets_manager_region}
S3_BUCKET=${s3_bucket}
LOG_LEVEL=info
EOF

# Get secrets from AWS Secrets Manager and append to .env
DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id ${db_secret_arn} --region ${secrets_manager_region} --query SecretString --output text | jq -r .password)
echo "DB_PASSWORD=$DB_PASSWORD" >> .env

# Get application secrets
APP_SECRETS=$(aws secretsmanager get-secret-value --secret-id ${app_secret_arn} --region ${secrets_manager_region} --query SecretString --output text)
echo "$APP_SECRETS" | jq -r 'to_entries[] | "\(.key)=\(.value)"' >> .env

# Create docker-compose.yml for production
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  app:
    image: resume-tailor-backend:latest
    container_name: resume-tailor-app
    restart: unless-stopped
    ports:
      - "${app_port}:3000"
    env_file:
      - .env
    volumes:
      - app_logs:/app/logs
      - app_uploads:/app/uploads
    logging:
      driver: awslogs
      options:
        awslogs-group: ${cloudwatch_log_group}
        awslogs-region: ${secrets_manager_region}
        awslogs-stream-prefix: app

volumes:
  app_logs:
  app_uploads:
EOF

# Configure CloudWatch agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << EOF
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "cwagent"
  },
  "metrics": {
    "namespace": "ResumeTrailor/${environment}",
    "metrics_collected": {
      "cpu": {
        "measurement": [
          "cpu_usage_idle",
          "cpu_usage_iowait",
          "cpu_usage_user",
          "cpu_usage_system"
        ],
        "metrics_collection_interval": 60
      },
      "disk": {
        "measurement": [
          "used_percent"
        ],
        "metrics_collection_interval": 60,
        "resources": [
          "*"
        ]
      },
      "diskio": {
        "measurement": [
          "io_time"
        ],
        "metrics_collection_interval": 60,
        "resources": [
          "*"
        ]
      },
      "mem": {
        "measurement": [
          "mem_used_percent"
        ],
        "metrics_collection_interval": 60
      },
      "netstat": {
        "measurement": [
          "tcp_established",
          "tcp_time_wait"
        ],
        "metrics_collection_interval": 60
      },
      "swap": {
        "measurement": [
          "swap_used_percent"
        ],
        "metrics_collection_interval": 60
      }
    }
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/messages",
            "log_group_name": "${cloudwatch_log_group}",
            "log_stream_name": "{instance_id}/system",
            "timezone": "UTC"
          },
          {
            "file_path": "/var/log/docker",
            "log_group_name": "${cloudwatch_log_group}",
            "log_stream_name": "{instance_id}/docker",
            "timezone": "UTC"
          }
        ]
      }
    }
  }
}
EOF

# Start CloudWatch agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s

# Create systemd service for the application
cat > /etc/systemd/system/resume-tailor.service << EOF
[Unit]
Description=Resume Tailor Backend
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/resume-tailor
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
systemctl daemon-reload
systemctl enable resume-tailor.service

# Pull the latest Docker image (this should be built and pushed to ECR)
# For now, we'll build it locally - in production, pull from ECR
# docker pull your-ecr-repo/resume-tailor-backend:latest

# Start the application
systemctl start resume-tailor.service

# Create health check script
cat > /opt/resume-tailor/health-check.sh << EOF
#!/bin/bash
curl -f http://localhost:${app_port}/health/quick || exit 1
EOF

chmod +x /opt/resume-tailor/health-check.sh

# Setup log rotation
cat > /etc/logrotate.d/resume-tailor << EOF
/opt/resume-tailor/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 ec2-user ec2-user
}
EOF

# Signal that the instance is ready
/opt/aws/bin/cfn-signal -e $? --stack ${AWS::StackName} --resource AutoScalingGroup --region ${AWS::Region} || true

echo "Resume Tailor Backend setup completed successfully!"
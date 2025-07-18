# Production Deployment Guide

This guide covers deploying the Resume Tailor backend to production with proper security, monitoring, and scalability.

## 🚀 Quick Deployment Checklist

### Prerequisites
- [ ] Node.js 18+ installed
- [ ] PostgreSQL 14+ database
- [ ] Domain name and SSL certificate
- [ ] Stripe account (live keys)
- [ ] Google Gemini API key
- [ ] Load balancer/reverse proxy (Nginx/Apache)

### Environment Setup
- [ ] All environment variables configured
- [ ] Database migrations run
- [ ] SSL/TLS certificates installed
- [ ] Firewall rules configured
- [ ] Monitoring tools setup

## 🔧 Environment Configuration

### Required Environment Variables

```bash
# Server Configuration
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Database Configuration
DB_HOST=your-db-host
DB_PORT=5432
DB_NAME=resume_tailor_prod
DB_USER=resume_tailor_user
DB_PASSWORD=your-secure-db-password

# SSL Database Connection (recommended for production)
DB_SSL_CA=/path/to/ca-certificate.crt
DB_SSL_KEY=/path/to/client-key.key
DB_SSL_CERT=/path/to/client-cert.crt

# Authentication
JWT_SECRET=your-very-secure-jwt-secret-at-least-32-characters
JWT_EXPIRES_IN=24h

# API Keys
GEMINI_API_KEY=your-production-gemini-api-key
PDF_CO_API_KEY=your-pdf-co-api-key

# Stripe (LIVE KEYS for production)
STRIPE_SECRET_KEY=sk_live_your_live_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# CORS and Security
ALLOWED_ORIGINS=https://yourdomain.com,chrome-extension://your-extension-id
CLIENT_URL=https://yourdomain.com

# Logging
LOG_LEVEL=info

# Optional: Force HTTPS
FORCE_HTTPS=true

# Optional: Session Configuration
SESSION_SECRET=your-session-secret
```

### Environment Variable Security

```bash
# Set proper file permissions
chmod 600 .env

# Use environment variable management tools
# - AWS Systems Manager Parameter Store
# - HashiCorp Vault
# - Kubernetes Secrets
# - Docker Secrets
```

## 🗄️ Database Setup

### 1. PostgreSQL Installation

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib

# CentOS/RHEL
sudo yum install postgresql-server postgresql-contrib
sudo postgresql-setup initdb

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### 2. Database Configuration

```sql
-- Connect as postgres user
sudo -u postgres psql

-- Create production database and user
CREATE DATABASE resume_tailor_prod;
CREATE USER resume_tailor_user WITH PASSWORD 'your-secure-password';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE resume_tailor_prod TO resume_tailor_user;
GRANT ALL ON SCHEMA public TO resume_tailor_user;

-- Enable UUID extension
\c resume_tailor_prod
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\q
```

### 3. SSL Configuration

```bash
# Enable SSL in postgresql.conf
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
ssl_ca_file = 'ca.crt'

# Update pg_hba.conf for SSL connections
hostssl all all 0.0.0.0/0 md5
```

### 4. Run Migrations

```bash
# Set environment variables
export NODE_ENV=production
export DB_HOST=your-db-host
# ... other variables

# Run database setup
npm run setup-db
```

## 🔒 Security Configuration

### 1. Firewall Setup

```bash
# Ubuntu/Debian (UFW)
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3000/tcp  # Application port
sudo ufw enable

# CentOS/RHEL (firewalld)
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

### 2. SSL/TLS Certificate

```bash
# Using Let's Encrypt (Certbot)
sudo apt install certbot
sudo certbot certonly --standalone -d yourdomain.com

# Or use your certificate provider
# Place certificates in /etc/ssl/certs/
```

### 3. Nginx Reverse Proxy

```nginx
# /etc/nginx/sites-available/resume-tailor
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;

    # Security Headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;

    # File Upload Limits
    client_max_body_size 10M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:3000/health;
        access_log off;
    }
}
```

## 🚀 Application Deployment

### 1. Using PM2 (Process Manager)

```bash
# Install PM2 globally
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'resume-tailor-backend',
    script: 'server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=1024'
  }]
};
EOF

# Start application
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save
pm2 startup
```

### 2. Using Docker

```dockerfile
# Dockerfile
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Bundle app source
COPY . .

# Create logs directory
RUN mkdir -p logs

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

CMD ["node", "server.js"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    depends_on:
      - postgres
    restart: unless-stopped
    volumes:
      - ./logs:/usr/src/app/logs

  postgres:
    image: postgres:14-alpine
    environment:
      POSTGRES_DB: resume_tailor_prod
      POSTGRES_USER: resume_tailor_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres_data:
```

### 3. Using Kubernetes

```yaml
# k8s-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: resume-tailor-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: resume-tailor-backend
  template:
    metadata:
      labels:
        app: resume-tailor-backend
    spec:
      containers:
      - name: resume-tailor-backend
        image: your-registry/resume-tailor-backend:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        envFrom:
        - secretRef:
            name: resume-tailor-secrets
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: resume-tailor-service
spec:
  selector:
    app: resume-tailor-backend
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

## 📊 Monitoring and Logging

### 1. Health Check Endpoint

The application includes a health check endpoint at `/health` that monitors:
- Database connectivity
- External API availability
- Memory usage
- Response times

### 2. Logging Configuration

```bash
# Create logs directory
mkdir -p logs

# Set proper permissions
chmod 755 logs

# Log rotation with logrotate
cat > /etc/logrotate.d/resume-tailor << EOF
/path/to/your/app/logs/*.log {
    daily
    missingok
    rotate 52
    compress
    delaycompress
    notifempty
    create 644 nodejs nodejs
    postrotate
        pm2 reload resume-tailor-backend
    endscript
}
EOF
```

### 3. Monitoring Tools

```bash
# Install monitoring tools
npm install -g pm2-logrotate
pm2 install pm2-server-monit

# Configure alerts
pm2 set pm2-server-monit:conf '{"email": "admin@yourdomain.com"}'
```

## 🔄 CI/CD Pipeline

### GitHub Actions Example

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run tests
      run: npm test
    
    - name: Build application
      run: npm run build
    
    - name: Deploy to server
      uses: appleboy/ssh-action@v0.1.5
      with:
        host: ${{ secrets.HOST }}
        username: ${{ secrets.USERNAME }}
        key: ${{ secrets.SSH_KEY }}
        script: |
          cd /path/to/your/app
          git pull origin main
          npm ci --only=production
          npm run migrate
          pm2 reload resume-tailor-backend
```

## 🚨 Backup and Recovery

### 1. Database Backups

```bash
# Create backup script
cat > backup-db.sh << EOF
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/postgresql"
mkdir -p $BACKUP_DIR

pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME > $BACKUP_DIR/resume_tailor_$DATE.sql

# Keep only last 7 days of backups
find $BACKUP_DIR -name "*.sql" -mtime +7 -delete
EOF

chmod +x backup-db.sh

# Add to crontab for daily backups
echo "0 2 * * * /path/to/backup-db.sh" | crontab -
```

### 2. Application Backups

```bash
# Backup application files
tar -czf app-backup-$(date +%Y%m%d).tar.gz \
  --exclude=node_modules \
  --exclude=logs \
  --exclude=.git \
  /path/to/your/app
```

## 🔍 Troubleshooting

### Common Issues

1. **Database Connection Errors**
   ```bash
   # Check PostgreSQL status
   sudo systemctl status postgresql
   
   # Check connection
   psql -h $DB_HOST -U $DB_USER -d $DB_NAME
   ```

2. **SSL Certificate Issues**
   ```bash
   # Check certificate validity
   openssl x509 -in /path/to/cert.pem -text -noout
   
   # Test SSL connection
   openssl s_client -connect yourdomain.com:443
   ```

3. **Memory Issues**
   ```bash
   # Monitor memory usage
   pm2 monit
   
   # Increase Node.js memory limit
   node --max-old-space-size=2048 server.js
   ```

4. **Rate Limiting Issues**
   ```bash
   # Check rate limit logs
   tail -f logs/combined.log | grep "RATE_LIMIT"
   
   # Adjust rate limits in production.js
   ```

### Performance Optimization

1. **Enable Gzip Compression** (already configured)
2. **Use CDN** for static assets
3. **Database Connection Pooling** (already configured)
4. **Caching** with Redis (optional)
5. **Load Balancing** with multiple instances

## 📋 Post-Deployment Checklist

- [ ] Application starts without errors
- [ ] Database connection successful
- [ ] All API endpoints responding
- [ ] SSL certificate valid
- [ ] Rate limiting working
- [ ] File uploads working
- [ ] Payment processing working
- [ ] Webhook endpoints accessible
- [ ] Monitoring alerts configured
- [ ] Backup system working
- [ ] Log rotation configured

## 🆘 Emergency Procedures

### Rollback Process
```bash
# Using PM2
pm2 stop resume-tailor-backend
git checkout previous-stable-commit
npm ci --only=production
pm2 start resume-tailor-backend

# Using Docker
docker-compose down
docker-compose up -d --build previous-tag
```

### Emergency Contacts
- Database Admin: [contact]
- DevOps Team: [contact]
- Security Team: [contact]

This deployment guide ensures a secure, scalable, and maintainable production environment for the Resume Tailor backend.
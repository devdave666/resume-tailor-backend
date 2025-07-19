# Docker Deployment Guide

This guide covers Docker containerization and deployment for the Resume Tailor Backend application.

## Quick Start

### Development Environment

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

2. **Start development environment:**
   ```bash
   # Linux/Mac
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
   
   # Windows PowerShell
   .\scripts\docker-deploy.ps1 -Environment development -Build
   ```

3. **Access services:**
   - Application: http://localhost:3000
   - Database: localhost:5432
   - Redis: localhost:6379
   - pgAdmin: http://localhost:5050

### Production Environment

1. **Build production image:**
   ```bash
   # Linux/Mac
   ./scripts/docker-build.sh
   
   # Windows
   docker build -t resume-tailor-backend:latest .
   ```

2. **Start production environment:**
   ```bash
   # Linux/Mac
   docker-compose --profile production up -d
   
   # Windows PowerShell
   .\scripts\docker-deploy.ps1 -Environment production
   ```

## Docker Configuration

### Multi-Stage Dockerfile

The Dockerfile uses multi-stage builds for optimization:

- **Builder stage**: Installs all dependencies
- **Production stage**: Creates minimal runtime image with only production dependencies

Key features:
- Alpine Linux base for smaller image size
- Non-root user for security
- Health checks for container monitoring
- Proper signal handling with dumb-init

### Docker Compose Services

#### Application (app)
- Main Node.js backend service
- Health checks and restart policies
- Volume mounts for logs and uploads
- Environment variable configuration

#### PostgreSQL (postgres)
- PostgreSQL 15 with Alpine Linux
- Persistent data storage
- Health checks and initialization scripts
- Development and production configurations

#### Redis (redis)
- Redis 7 for caching and rate limiting
- Persistent data storage
- Password protection support
- Health monitoring

#### Nginx (nginx)
- Reverse proxy for production
- SSL termination and security headers
- Rate limiting and compression
- Static file serving

#### pgAdmin (development only)
- Database administration interface
- Available only in development environment
- Web-based PostgreSQL management

## Environment Configuration

### Required Environment Variables

```bash
# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=resume_tailor
DB_USER=postgres
DB_PASSWORD=your_secure_password

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# Application
NODE_ENV=production
PORT=3000
JWT_SECRET=your_jwt_secret
CLIENT_URL=https://your-domain.com

# External APIs
GEMINI_API_KEY=your_gemini_key
STRIPE_SECRET_KEY=your_stripe_key
STRIPE_WEBHOOK_SECRET=your_webhook_secret
```

### Development vs Production

**Development:**
- Hot reload with nodemon
- Debug port exposed (9229)
- pgAdmin included
- Verbose logging
- Source code mounted as volume

**Production:**
- Optimized Node.js runtime
- Nginx reverse proxy
- SSL termination
- Security headers
- Rate limiting
- Log aggregation

## Docker Commands

### Building Images

```bash
# Build development image
docker build --target builder -t resume-tailor-backend:dev .

# Build production image
docker build --target production -t resume-tailor-backend:prod .

# Build with version tag
docker build -t resume-tailor-backend:v1.0.0 .
```

### Managing Services

```bash
# Start all services
docker-compose up -d

# Start specific service
docker-compose up -d postgres

# View logs
docker-compose logs -f app

# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down --volumes
```

### Database Operations

```bash
# Run database migrations
docker-compose exec app npm run migrate

# Setup database
docker-compose exec app npm run setup-db

# Access PostgreSQL
docker-compose exec postgres psql -U postgres -d resume_tailor

# Backup database
docker-compose exec postgres pg_dump -U postgres resume_tailor > backup.sql
```

### Monitoring and Debugging

```bash
# Check service status
docker-compose ps

# View resource usage
docker stats

# Execute commands in container
docker-compose exec app sh

# View application logs
docker-compose logs -f app

# Health check
curl http://localhost:3000/health
```

## Production Deployment

### Prerequisites

1. **Docker and Docker Compose installed**
2. **SSL certificates** (place in `nginx/ssl/`)
3. **Environment variables** configured
4. **Database** initialized with migrations

### Deployment Steps

1. **Prepare environment:**
   ```bash
   # Create production .env file
   cp .env.example .env.production
   # Edit with production values
   ```

2. **Build and deploy:**
   ```bash
   # Build production image
   ./scripts/docker-build.sh v1.0.0
   
   # Deploy with production profile
   docker-compose --profile production up -d
   ```

3. **Verify deployment:**
   ```bash
   # Check all services are running
   docker-compose ps
   
   # Test health endpoint
   curl https://your-domain.com/health
   
   # Check logs
   docker-compose logs -f
   ```

### SSL Configuration

Place your SSL certificates in the `nginx/ssl/` directory:
- `cert.pem` - SSL certificate
- `key.pem` - Private key

For Let's Encrypt certificates:
```bash
# Create SSL directory
mkdir -p nginx/ssl

# Copy certificates
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem nginx/ssl/cert.pem
cp /etc/letsencrypt/live/your-domain.com/privkey.pem nginx/ssl/key.pem
```

## Troubleshooting

### Common Issues

1. **Port conflicts:**
   ```bash
   # Check what's using the port
   netstat -tulpn | grep :3000
   
   # Change port in docker-compose.yml
   ports:
     - "3001:3000"
   ```

2. **Database connection issues:**
   ```bash
   # Check PostgreSQL logs
   docker-compose logs postgres
   
   # Verify database is ready
   docker-compose exec postgres pg_isready
   ```

3. **Permission issues:**
   ```bash
   # Fix file permissions
   sudo chown -R $USER:$USER .
   
   # Check container user
   docker-compose exec app id
   ```

4. **Memory issues:**
   ```bash
   # Check container resource usage
   docker stats
   
   # Increase memory limits in docker-compose.yml
   deploy:
     resources:
       limits:
         memory: 1G
   ```

### Health Checks

The application includes comprehensive health checks:

- **Container health check**: Built into Dockerfile
- **Application health**: `/health` endpoint
- **Quick health**: `/health/quick` endpoint
- **Database health**: PostgreSQL ready check
- **Redis health**: Redis ping check

### Logging

Logs are available through Docker Compose:

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f app

# With timestamps
docker-compose logs -f -t app

# Last 100 lines
docker-compose logs --tail=100 app
```

## Security Considerations

1. **Non-root user**: Application runs as nodejs user
2. **Read-only filesystem**: Where possible
3. **Security headers**: Implemented in Nginx
4. **Rate limiting**: Applied at Nginx level
5. **SSL/TLS**: Enforced in production
6. **Secrets management**: Environment variables only
7. **Image scanning**: Use `docker scout` for vulnerability scanning

## Performance Optimization

1. **Multi-stage builds**: Smaller production images
2. **Layer caching**: Optimized Dockerfile layer order
3. **Compression**: Gzip enabled in Nginx
4. **Connection pooling**: Database and Redis connections
5. **Health checks**: Proper container orchestration
6. **Resource limits**: Prevent resource exhaustion

This Docker setup provides a production-ready containerization solution with development convenience and production security.
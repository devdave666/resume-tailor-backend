# Database Setup Guide

This guide will help you set up PostgreSQL for the Resume Tailor backend.

## Prerequisites

1. **PostgreSQL installed** - Download from [postgresql.org](https://www.postgresql.org/download/)
2. **Node.js dependencies installed** - Run `npm install`

## Quick Setup

### 1. Install PostgreSQL
- **Windows**: Download installer from postgresql.org
- **macOS**: `brew install postgresql` or use installer
- **Linux**: `sudo apt-get install postgresql postgresql-contrib`

### 2. Create Database
```bash
# Connect to PostgreSQL as superuser
psql -U postgres

# Create database and user
CREATE DATABASE resume_tailor;
CREATE USER resume_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE resume_tailor TO resume_user;
\q
```

### 3. Configure Environment
Copy `.env.example` to `.env` and update database settings:
```bash
cp .env.example .env
```

Edit `.env` file:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=resume_tailor
DB_USER=resume_user
DB_PASSWORD=your_secure_password
```

### 4. Setup Database Schema
Run the setup script:
```bash
npm run setup-db
```

This will:
- ✅ Validate your database configuration
- ✅ Test the database connection
- ✅ Run all migrations to create tables
- ✅ Set up indexes and triggers

## Manual Migration

If you need to run migrations separately:
```bash
npm run migrate
```

## Database Schema

The setup creates these tables:

### `users`
- User authentication and token management
- Stores email, password hash, token balance
- Stripe customer ID for payments

### `generations` 
- Tracks resume generation history
- Links to user and stores job descriptions
- Status tracking for completed/failed generations

### `api_usage`
- API endpoint usage tracking
- Token consumption monitoring
- Analytics and rate limiting data

## Troubleshooting

### Connection Issues
1. **PostgreSQL not running**: Start the service
   - Windows: Services → PostgreSQL
   - macOS: `brew services start postgresql`
   - Linux: `sudo systemctl start postgresql`

2. **Authentication failed**: Check username/password in `.env`

3. **Database doesn't exist**: Create it manually:
   ```sql
   CREATE DATABASE resume_tailor;
   ```

### Permission Issues
Grant proper permissions:
```sql
GRANT ALL PRIVILEGES ON DATABASE resume_tailor TO your_user;
GRANT ALL ON SCHEMA public TO your_user;
```

## Production Setup

For production, consider:
- Using connection pooling (already configured)
- Setting up read replicas for scaling
- Regular backups
- Monitoring and alerting
- SSL connections

## Environment Variables

Required database environment variables:
```env
DB_HOST=localhost          # Database host
DB_PORT=5432              # Database port
DB_NAME=resume_tailor     # Database name
DB_USER=resume_user       # Database user
DB_PASSWORD=secure_pass   # Database password
LOG_LEVEL=info           # Logging level
```

## Next Steps

After database setup:
1. Start the server: `npm run dev`
2. Test the connection at: `http://localhost:3000/test/health`
3. Continue with authentication setup (Task 2)
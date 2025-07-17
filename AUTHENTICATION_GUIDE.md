# Authentication System Guide

The Resume Tailor backend now includes a complete JWT-based authentication system that replaces the old hardcoded user ID system.

## 🔐 Authentication Endpoints

### Register New User
```bash
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123"
}
```

**Response:**
```json
{
  "message": "User registered successfully",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "tokens": 5,
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h"
}
```

### Login User
```bash
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "tokens": 5
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h"
}
```

### Get User Profile
```bash
GET /auth/profile
Authorization: Bearer <jwt_token>
```

### Refresh Token
```bash
POST /auth/refresh
Authorization: Bearer <jwt_token>
```

## 🔒 Protected Endpoints

All generation and token-related endpoints now require authentication:

- `GET /get-token-balance` - Requires JWT token
- `POST /generate` - Requires JWT token
- `POST /quick-generate` - Requires JWT token
- `POST /create-payment-session` - Requires JWT token

### Using Protected Endpoints
Include the JWT token in the Authorization header:

```bash
POST /generate
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: multipart/form-data

# Form data with resume file and job description
```

## 🛡️ Security Features

### Password Requirements
- Minimum 8 characters
- At least one lowercase letter
- At least one uppercase letter  
- At least one number

### JWT Token Security
- Tokens expire after 24 hours (configurable)
- Signed with secure secret key
- Include user ID and email in payload
- Automatic validation on protected routes

### Database Security
- Passwords hashed with bcrypt (12 rounds)
- SQL injection prevention with prepared statements
- Atomic token operations with database transactions

## 🔧 Configuration

Required environment variables:

```env
# JWT Configuration
JWT_SECRET="your-secure-jwt-secret-key-here"
JWT_EXPIRES_IN="24h"

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=resume_tailor
DB_USER=postgres
DB_PASSWORD=your_password_here
```

## 📱 Chrome Extension Integration

The Chrome extension needs to be updated to:

1. **Store JWT tokens** in extension storage
2. **Include Authorization header** in all API requests
3. **Handle authentication flow** (login/register)
4. **Refresh tokens** when they expire

### Example Extension Code
```javascript
// Store token after login
chrome.storage.local.set({ 'auth_token': response.token });

// Include token in API requests
const token = await chrome.storage.local.get('auth_token');
fetch('/api/generate', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token.auth_token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(data)
});
```

## 🚨 Error Handling

### Authentication Errors
- `401 MISSING_TOKEN` - No token provided
- `401 TOKEN_EXPIRED` - Token has expired
- `401 INVALID_TOKEN` - Token is malformed or invalid
- `401 USER_NOT_FOUND` - User associated with token doesn't exist

### Registration Errors
- `400 VALIDATION_ERROR` - Invalid email or weak password
- `409 USER_EXISTS` - Email already registered

### Login Errors
- `401 INVALID_CREDENTIALS` - Wrong email or password

## 🔄 Migration from Old System

The old JSON file-based system has been completely replaced:

### ❌ Old System (Removed)
- Hardcoded `user123` ID
- JSON file storage (`db.json`)
- No authentication required

### ✅ New System (Current)
- JWT-based authentication
- PostgreSQL database storage
- Secure user registration and login
- Token-based API access

## 🧪 Testing Authentication

### 1. Register a Test User
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123"}'
```

### 2. Login and Get Token
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123"}'
```

### 3. Test Protected Endpoint
```bash
curl -X GET http://localhost:3000/get-token-balance \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE"
```

## 🔍 Troubleshooting

### Common Issues

1. **JWT_SECRET not set**
   - Error: "JWT configuration validation failed"
   - Solution: Set JWT_SECRET in .env file

2. **Database connection failed**
   - Error: "Database connection failed"
   - Solution: Check database configuration and ensure PostgreSQL is running

3. **Token expired**
   - Error: "TOKEN_EXPIRED"
   - Solution: Login again to get a new token or implement token refresh

4. **Invalid credentials**
   - Error: "INVALID_CREDENTIALS"
   - Solution: Check email and password are correct

The authentication system is now fully integrated and ready for production use!
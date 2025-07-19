# Secrets Manager Configuration

# Application Secrets
resource "aws_secretsmanager_secret" "app_secrets" {
  name                    = "${local.name_prefix}-app-secrets"
  description             = "Application secrets for Resume Tailor"
  recovery_window_in_days = var.environment == "prod" ? 30 : 0

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-app-secrets"
  })
}

# Application Secrets Version (placeholder - update with actual values)
resource "aws_secretsmanager_secret_version" "app_secrets" {
  secret_id = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    JWT_SECRET           = "CHANGE_ME_IN_PRODUCTION"
    GEMINI_API_KEY      = "CHANGE_ME_IN_PRODUCTION"
    STRIPE_SECRET_KEY   = "CHANGE_ME_IN_PRODUCTION"
    STRIPE_WEBHOOK_SECRET = "CHANGE_ME_IN_PRODUCTION"
    PDF_CO_API_KEY      = "CHANGE_ME_IN_PRODUCTION"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# IAM Policy for accessing secrets
resource "aws_iam_policy" "secrets_access" {
  name        = "${local.name_prefix}-secrets-access"
  description = "Policy for accessing application secrets"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.db_password.arn,
          aws_secretsmanager_secret.app_secrets.arn
        ]
      }
    ]
  })

  tags = local.common_tags
}

# Attach secrets policy to EC2 role
resource "aws_iam_role_policy_attachment" "ec2_secrets_access" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = aws_iam_policy.secrets_access.arn
}
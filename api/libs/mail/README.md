# Email Module

This module provides email functionality for Dify, including SMTP with OAuth 2.0 support for Microsoft Exchange/Outlook.

## Features

- Basic SMTP authentication
- OAuth 2.0 authentication for Microsoft Exchange/Outlook
- Multiple email providers: SMTP, SendGrid, Resend
- TLS/SSL support
- Microsoft Exchange compliance (Basic Auth retirement September 2025)

## Configuration

### Basic SMTP Configuration

```env
MAIL_TYPE=smtp
MAIL_DEFAULT_SEND_FROM=your-email@company.com
SMTP_SERVER=smtp.company.com
SMTP_PORT=587
SMTP_USERNAME=your-email@company.com
SMTP_PASSWORD=your-password
SMTP_USE_TLS=true
SMTP_OPPORTUNISTIC_TLS=true
SMTP_AUTH_TYPE=basic
```

### Microsoft Exchange OAuth 2.0 Configuration

For Microsoft Exchange/Outlook compatibility:

```env
MAIL_TYPE=smtp
MAIL_DEFAULT_SEND_FROM=your-email@company.com
SMTP_SERVER=smtp.office365.com
SMTP_PORT=587
SMTP_USERNAME=your-email@company.com
SMTP_USE_TLS=true
SMTP_OPPORTUNISTIC_TLS=true
SMTP_AUTH_TYPE=oauth2

# Microsoft OAuth 2.0 Settings
MICROSOFT_OAUTH2_CLIENT_ID=your-azure-app-client-id
MICROSOFT_OAUTH2_CLIENT_SECRET=your-azure-app-client-secret
MICROSOFT_OAUTH2_TENANT_ID=your-tenant-id
```

## Microsoft Azure AD App Setup

### 1. Create Azure AD Application

1. Go to [Azure Portal](https://portal.azure.com) → Azure Active Directory → App registrations
2. Click "New registration"
3. Enter application name (e.g., "Dify Email Service")
4. Select "Accounts in this organizational directory only"
5. Click "Register"

### 2. Configure API Permissions

1. Go to "API permissions"
2. Click "Add a permission" → Microsoft Graph
3. Select "Application permissions"
4. Add these permissions:
   - `Mail.Send` - Send mail as any user
   - `SMTP.Send` - Send email via SMTP AUTH
5. Click "Grant admin consent"

### 3. Create Client Secret

1. Go to "Certificates & secrets"
2. Click "New client secret"
3. Enter description and expiration
4. Copy the secret value (you won't see it again)

### 4. Get Configuration Values

- **Client ID**: Application (client) ID from Overview page
- **Client Secret**: The secret value you just created
- **Tenant ID**: Directory (tenant) ID from Overview page

## Usage Examples

### Basic Usage

The email service is automatically configured based on environment variables. Simply use the mail extension:

```python
from extensions.ext_mail import mail

# Send email
mail_data = {
    "to": "recipient@example.com",
    "subject": "Test Email",
    "html": "<h1>Hello World</h1>"
}

try:
    mail._client.send(mail_data)
    print("Email sent successfully")
except Exception as e:
    print(f"Failed to send email: {e}")
```

### OAuth Token Management

For service accounts using client credentials flow:

```python
from libs.mail.oauth_email import MicrosoftEmailOAuth

# Initialize OAuth client
oauth_client = MicrosoftEmailOAuth(
    client_id="your-client-id",
    client_secret="your-client-secret",
    redirect_uri="",  # Not needed for client credentials
    tenant_id="your-tenant-id"
)

# Get access token
try:
    token_response = oauth_client.get_access_token_client_credentials()
    access_token = token_response["access_token"]
    print(f"Access token obtained: {access_token[:10]}...")
except Exception as e:
    print(f"Failed to get OAuth token: {e}")
```

### Custom SMTP Client

For direct SMTP usage with OAuth:

```python
from libs.mail import SMTPClient

# Create SMTP client with OAuth
client = SMTPClient(
    server="smtp.office365.com",
    port=587,
    username="your-email@company.com",
    password="",  # Not used with OAuth
    from_addr="your-email@company.com",
    use_tls=True,
    opportunistic_tls=True,
    oauth_access_token="your-access-token",
    auth_type="oauth2"
)

# Send email
mail_data = {
    "to": "recipient@example.com",
    "subject": "OAuth Test",
    "html": "<p>Sent via OAuth 2.0</p>"
}

client.send(mail_data)
```

## Migration from Basic Auth

### Microsoft Exchange Migration

Microsoft is retiring Basic Authentication for Exchange Online in September 2025. Follow these steps to migrate:

1. **Set up Azure AD Application** (see setup instructions above)
2. **Update configuration** to use OAuth 2.0:

   ```env
   SMTP_AUTH_TYPE=oauth2
   MICROSOFT_OAUTH2_CLIENT_ID=your-client-id
   MICROSOFT_OAUTH2_CLIENT_SECRET=your-client-secret
   MICROSOFT_OAUTH2_TENANT_ID=your-tenant-id
   ```

3. **Test the configuration** before the migration deadline
4. **Remove old password-based settings** once OAuth is working

### Backward Compatibility

The system maintains backward compatibility:

- Existing Basic Auth configurations continue to work
- OAuth settings are optional and only used when `SMTP_AUTH_TYPE=oauth2`
- Gradual migration is supported

## Troubleshooting

### Common OAuth Issues

1. **Token acquisition fails**:
   - Verify Client ID and Secret are correct
   - Check that admin consent was granted for API permissions
   - Ensure Tenant ID is correct

2. **SMTP authentication fails**:
   - Verify the access token is valid and not expired
   - Check that SMTP.Send permission is granted
   - Ensure the user has Send As permissions

3. **Configuration issues**:
   - Verify all required environment variables are set
   - Check SMTP server and port settings
   - Ensure TLS settings match your server requirements

### Testing Token Acquisition

```python
from libs.mail.oauth_email import MicrosoftEmailOAuth

def test_oauth_token():
    oauth_client = MicrosoftEmailOAuth(
        client_id="your-client-id",
        client_secret="your-client-secret",
        redirect_uri="",
        tenant_id="your-tenant-id"
    )
    
    try:
        response = oauth_client.get_access_token_client_credentials()
        print("✓ OAuth token acquired successfully")
        print(f"Token type: {response.get('token_type')}")
        print(f"Expires in: {response.get('expires_in')} seconds")
        return True
    except Exception as e:
        print(f"✗ OAuth token acquisition failed: {e}")
        return False

if __name__ == "__main__":
    test_oauth_token()
```

## Security Considerations

### Token Management

- Access tokens are automatically obtained when needed
- Tokens are not stored permanently
- Client credentials flow is used for service accounts
- Secrets should be stored securely in environment variables

### Network Security

- Always use TLS for SMTP connections (`SMTP_USE_TLS=true`)
- Use opportunistic TLS when supported (`SMTP_OPPORTUNISTIC_TLS=true`)
- Verify SMTP server certificates in production

### Access Control

- Grant minimum required permissions in Azure AD
- Use dedicated service accounts for email sending
- Regularly rotate client secrets
- Monitor access logs for suspicious activity

## Dependencies

The email module uses these internal components:

- `libs.mail.smtp`: Core SMTP client with OAuth support
- `libs.mail.oauth_email`: Microsoft OAuth 2.0 implementation
- `libs.mail.oauth_http_client`: HTTP client abstraction
- `libs.mail.smtp_connection`: SMTP connection management
- `extensions.ext_mail`: Flask extension for email integration

## Testing

The module includes comprehensive tests with proper mocking:

- `tests/unit_tests/libs/mail/test_oauth_email.py`: OAuth functionality tests
- `tests/unit_tests/libs/mail/test_smtp_enhanced.py`: SMTP client tests

Run tests with:

```bash
uv run pytest tests/unit_tests/libs/mail/test_oauth_email.py -v
uv run pytest tests/unit_tests/libs/mail/test_smtp_enhanced.py -v
```

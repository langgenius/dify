# Dify Mail Sending Architecture

## Overview

To address Microsoft's upcoming discontinuation of Basic Auth support, we have redesigned Dify's mail sending system using a Protocol-based architecture that supports multiple authentication methods and email service providers.

## Design Principles

1. **Protocol-Driven**: Uses Python Protocol to define unified mail sending interfaces
2. **Authentication Abstraction**: Hides Basic Auth and OAuth2 authentication details in implementation layers
3. **Extensibility**: Easy to add new email service providers and authentication methods
4. **Backward Compatibility**: Maintains compatibility with existing configuration methods
5. **User Experience**: Transparent to users with minimal configuration changes

## Architecture Components

### 1. Core Protocol (`protocol.py`)

```python
@runtime_checkable
class MailSender(Protocol):
    def send(self, message: MailMessage) -> None: ...
    def is_configured(self) -> bool: ...
    def test_connection(self) -> bool: ...

@dataclass
class MailMessage:
    to: str
    subject: str
    html: str
    from_: Optional[str] = None
    # ... other fields
```

### 2. SMTP Implementations

#### Basic Auth (`smtp_basic.py`)

- Traditional username/password authentication
- Supports TLS and STARTTLS
- Backward compatible with existing configurations

#### OAuth2 (`smtp_oauth2.py`)

- Supports Microsoft OAuth2 (Client Credentials Flow)
- Automatic token management and refresh
- Enterprise-ready security

#### Unified Interface (`smtp_sender.py`)

- Automatically selects authentication method based on configuration
- Provides unified SMTP sending interface

### 3. Third-Party Service Adapters

- **Resend** (`resend_sender.py`)
- **SendGrid** (`sendgrid_sender.py`)

### 4. Factory Pattern (`factory.py`)

```python
# Automatically create mail sender from Dify configuration
sender = MailSenderFactory.create_from_dify_config(dify_config)

# Manually create specific type of sender
sender = MailSenderFactory.create_sender("smtp", config)
```

## Configuration

### SMTP Basic Auth (Existing Method)

```bash
MAIL_TYPE=smtp
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=user@gmail.com
SMTP_PASSWORD=app-password
SMTP_USE_TLS=true
SMTP_AUTH_TYPE=basic
```

### SMTP OAuth2 (New)

#### Microsoft OAuth2

```bash
MAIL_TYPE=smtp
SMTP_SERVER=smtp.office365.com
SMTP_PORT=587
SMTP_USERNAME=user@company.com
SMTP_USE_TLS=true
SMTP_AUTH_TYPE=oauth2
SMTP_OAUTH2_PROVIDER=microsoft
SMTP_CLIENT_ID=your-azure-app-client-id
SMTP_CLIENT_SECRET=your-azure-app-client-secret
SMTP_TENANT_ID=your-azure-tenant-id
```

## Microsoft OAuth2 Setup Guide

### 1. Azure AD App Registration

1. Sign in to [Azure Portal](https://portal.azure.com)
2. Navigate to "Azure Active Directory" > "App registrations"
3. Click "New registration"
4. Fill in application information:
   - Name: "Dify Mail Service"
   - Supported account types: "Accounts in this organizational directory only"
   - Redirect URI: Not needed (server application)

### 2. Configure API Permissions

1. In the app page, click "API permissions"
2. Click "Add a permission"
3. Select "Microsoft Graph"
4. Select "Application permissions"
5. Add the following permissions:
   - `Mail.Send` - Send mail
   - `Mail.ReadWrite` - Read and write mail (if needed)

### 3. Create Client Secret

1. Click "Certificates & secrets"
2. Click "New client secret"
3. Set description and expiration time
4. Copy the generated secret value (shown only once)

### 4. Get Tenant ID

1. Find "Tenant ID" in the Azure AD overview page
2. Copy this ID for configuration

## Usage Examples

### Basic Usage

```python
from libs.mail import MailMessage, MailSenderFactory

# Create mail message
message = MailMessage(
    to="recipient@example.com",
    subject="Test Email",
    html="<h1>Hello from Dify!</h1>",
    from_="sender@company.com"
)

# Create sender from configuration
sender = MailSenderFactory.create_from_dify_config(dify_config)

# Send email
if sender and sender.is_configured():
    sender.send(message)
```

### SMTP Basic Auth Example

```python
# Configuration for SMTP Basic Auth
config = {
    "server": "smtp.gmail.com",
    "port": 587,
    "username": "your-email@gmail.com",
    "password": "your-app-password",
    "use_tls": True,
    "auth_type": "basic",
    "default_from": "your-email@gmail.com"
}

# Create sender
sender = MailSenderFactory.create_sender("smtp", config)

# Create and send message
message = MailMessage(
    to="recipient@example.com",
    subject="Test Email - Basic Auth",
    html="<h1>Hello from Dify!</h1><p>This email was sent using SMTP Basic Auth.</p>",
    from_="your-email@gmail.com"
)

sender.send(message)
```

### Microsoft OAuth2 Example

```python
# Configuration for Microsoft OAuth2
config = {
    "server": "smtp.office365.com",
    "port": 587,
    "username": "your-email@company.com",
    "use_tls": True,
    "auth_type": "oauth2",
    "oauth2_provider": "microsoft",
    "client_id": "your-azure-app-client-id",
    "client_secret": "your-azure-app-client-secret",
    "tenant_id": "your-azure-tenant-id",
    "default_from": "your-email@company.com"
}

# Create sender
sender = MailSenderFactory.create_sender("smtp", config)

# Create and send message
message = MailMessage(
    to="recipient@company.com",
    subject="Test Email - OAuth2",
    html="<h1>Hello from Dify!</h1><p>This email was sent using Microsoft OAuth2.</p>",
    from_="sender@company.com"
)

sender.send(message)
```

### Third-Party Services

#### Resend Service

```python
config = {
    "api_key": "your-resend-api-key",
    "default_from": "noreply@yourdomain.com"
}

sender = MailSenderFactory.create_sender("resend", config)
```

#### SendGrid Service

```python
config = {
    "api_key": "your-sendgrid-api-key",
    "default_from": "noreply@yourdomain.com"
}

sender = MailSenderFactory.create_sender("sendgrid", config)
```

## Testing

### Unit Tests

```bash
python -m pytest tests/unit_tests/libs/test_mail.py -v
```

### Integration Tests

```bash
python -m pytest tests/integration_tests/test_mail_integration.py -v
```

## Troubleshooting

### Common Issues

1. **OAuth2 Authentication Failure**
   - Check if Client ID, Client Secret, and Tenant ID are correct
   - Ensure Azure AD app permissions are properly configured and admin consent is granted

2. **SMTP Connection Failure**
   - Check server address and port
   - Ensure TLS settings are correct

3. **Email Send Failure**
   - Check if sender email address is valid
   - Ensure recipient email address format is correct

### Debug Logging

Enable detailed logging:

```python
import logging
logging.getLogger('libs.mail').setLevel(logging.DEBUG)
```

## API Reference

### MailMessage

```python
@dataclass
class MailMessage:
    to: str                           # Recipient email address
    subject: str                      # Email subject
    html: str                         # Email HTML content
    from_: Optional[str] = None       # Sender email address
    cc: Optional[List[str]] = None    # CC recipients
    bcc: Optional[List[str]] = None   # BCC recipients
    reply_to: Optional[str] = None    # Reply-to address
```

### MailSender Protocol

```python
class MailSender(Protocol):
    def send(self, message: MailMessage) -> None:
        """Send an email message"""
        
    def is_configured(self) -> bool:
        """Check if sender is properly configured"""
        
    def test_connection(self) -> bool:
        """Test connection to mail service"""
```

### MailSenderFactory

```python
class MailSenderFactory:
    @classmethod
    def create_sender(cls, mail_type: str, config: dict) -> MailSender:
        """Create a mail sender instance"""
        
    @classmethod
    def create_from_dify_config(cls, dify_config) -> Optional[MailSender]:
        """Create sender from Dify configuration"""
        
    @classmethod
    def get_supported_types(cls) -> list[str]:
        """Get list of supported mail types"""
```

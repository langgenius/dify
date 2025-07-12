# Multi-Factor Authentication (MFA) Implementation

## Overview
Dify implements TOTP-based Multi-Factor Authentication with backup codes for enhanced account security.

## Features

### 1. TOTP Authentication
- **Standard**: RFC 6238 compliant
- **Library**: `pyotp` (Python) 
- **Apps**: Compatible with Google Authenticator, Authy, etc.
- **Code Length**: 6 digits
- **Validity Window**: 30 seconds ±1 window

### 2. Backup Codes
- **Count**: 8 codes per account
- **Format**: 8-character hex strings (uppercase)
- **Usage**: One-time use, automatically removed after use
- **Storage**: JSON array in database

### 3. QR Code Generation
- **Format**: Base64 encoded PNG image
- **Size**: 200x200 pixels
- **Error Correction**: Low level
- **Contents**: `otpauth://totp/Dify:user@example.com?secret=...&issuer=Dify`

## API Endpoints

### Authentication
- `POST /console/api/login` - Login with MFA support
  - Parameters: `email`, `password`, `mfa_code`, `is_backup_code`
  - Response: `mfa_required` or success with tokens

### MFA Management
- `GET /console/api/account/mfa/status` - Get MFA status
- `POST /console/api/account/mfa/setup` - Initialize MFA setup
- `POST /console/api/account/mfa/setup/complete` - Complete setup with TOTP verification
- `POST /console/api/account/mfa/disable` - Disable MFA with password verification

## Database Schema

### `account_mfa_settings` Table
```sql
CREATE TABLE account_mfa_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id),
    enabled BOOLEAN DEFAULT FALSE,
    secret VARCHAR(255),
    backup_codes TEXT, -- JSON array of backup codes
    setup_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## User Flow

### 1. MFA Setup
1. User navigates to Account Settings → Two-Factor Authentication
2. Clicks "Enable" button
3. QR code and manual key displayed
4. User scans QR code with authenticator app
5. User enters 6-digit TOTP code
6. System validates code and generates backup codes
7. User saves backup codes
8. MFA is enabled

### 2. Login with MFA
1. User enters email/password
2. System returns `{"result": "fail", "code": "mfa_required"}`
3. Frontend displays MFA input screen
4. User enters TOTP code or backup code
5. System validates and logs user in

### 3. MFA Disable
1. User navigates to Account Settings → Two-Factor Authentication
2. Clicks "Disable" button
3. Enters password for verification
4. System disables MFA and clears settings

## Error Handling

### API Errors
- `mfa_required`: MFA code needed for login
- `mfa_token_invalid`: Invalid MFA code format (binascii.Error)
- `mfa_token_required`: Invalid or expired MFA token

### Frontend Errors
- Token length validation (must be 6 digits)
- Network error handling
- Invalid authentication code display

## Security Features

### 1. Rate Limiting
- Login attempts are rate-limited per email
- MFA verification includes existing rate limiting

### 2. Secret Security
- Secrets are base32 encoded
- Stored directly in database (encrypted at rest)
- Generated using `pyotp.random_base32()`

### 3. Backup Code Security
- Each code can only be used once
- Codes are removed from database after use
- Stored as JSON array in database

## Implementation Details

### Backend (Python/Flask)
- **Services**: `MFAService` handles all MFA operations
- **Controllers**: `LoginApi`, `MFASetupInitApi`, `MFASetupCompleteApi`, `MFADisableApi`
- **Models**: `AccountMFASettings` model with SQLAlchemy

### Frontend (React/TypeScript)
- **Components**: `MFAPage`, `MFAVerification` components
- **State Management**: React Query for API calls
- **UI**: Headless UI Modal components with proper z-index handling

### Error Handling
- **Custom Handler**: `ExternalApi.handle_error()` in `libs/external_api.py`
- **binascii.Error**: Converted to `mfa_token_invalid` (lines 44-54)
- **ValueError**: Non-base32 errors handled specifically (lines 55-69)

## Internationalization (i18n)

### Supported Languages
- English (`en-US`)
- Japanese (`ja-JP`) 
- Chinese Simplified (`zh-Hans`)
- German (`de-DE`)

### Translation Keys
```typescript
// mfa.ts
{
  title: 'Two-Factor Authentication',
  enable: 'Enable',
  disable: 'Disable',
  next: 'Next',
  copy: 'Copy',
  copied: 'Copied',
  done: 'Done',
  // ... more keys
}
```

## Testing

### Manual Testing
1. MFA setup flow with QR code scanning
2. Login with valid/invalid TOTP codes
3. Login with backup codes
4. MFA disable functionality
5. Error handling for various scenarios

### Integration Points
- Database migration for `account_mfa_settings` table
- Docker container rebuilds required for code changes
- nginx-proxy restart may be needed for routing

## Known Issues and Solutions

### 1. Click Blocking Issue
- **Problem**: Dialog component (z-index: 40) blocked by overlays
- **Solution**: Use Modal component (z-index: 70) instead

### 2. Parameter Mismatch
- **Problem**: Backend expected `mfa_token`, frontend sent `mfa_code`
- **Solution**: Updated API to use `mfa_code` consistently

### 3. Error Message Conversion
- **Problem**: `binascii.Error` became generic `invalid_param`
- **Solution**: Added specific error handling in `ExternalApi`

## Maintenance

### Regular Tasks
- Monitor MFA usage and error rates
- Update backup code generation if needed
- Review security of secret storage

### Dependencies
- `pyotp`: TOTP generation and verification
- `qrcode`: QR code image generation
- `binascii`: Base32 encoding/decoding

## Future Enhancements

### Potential Features
- SMS-based MFA as alternative
- Hardware token support (U2F/WebAuthn)
- MFA recovery via admin
- MFA enforcement policies
- Audit logging for MFA events

---

*Last updated: 2025-07-09*  
*Implementation completed and tested successfully*

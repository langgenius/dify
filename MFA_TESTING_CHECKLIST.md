# MFA Testing Checklist

## Pre-test Setup
- [ ] Docker containers built successfully
- [ ] All containers running without errors
- [ ] Application accessible at http://localhost:3000
- [ ] Database migrations applied successfully

## MFA Setup Testing
1. [ ] Navigate to Account Settings
2. [ ] Click on "Two-Factor Authentication" tab
3. [ ] Verify MFA page loads without errors
4. [ ] Click "Set up" or "Enable" button
5. [ ] Verify QR code is displayed
6. [ ] Scan QR code with authenticator app (Google Authenticator, Authy, etc.)
7. [ ] Enter 6-digit code from authenticator
8. [ ] Verify MFA setup success message
9. [ ] Verify backup codes are displayed
10. [ ] Save backup codes securely

## MFA Login Testing
1. [ ] Log out of the application
2. [ ] Enter username/email and password
3. [ ] Verify MFA code prompt appears
4. [ ] Enter correct code from authenticator
5. [ ] Verify successful login
6. [ ] Test with incorrect code - verify error message
7. [ ] Test with backup code - verify it works

## MFA Management Testing
1. [ ] Navigate back to MFA settings
2. [ ] Verify MFA status shows as "Enabled"
3. [ ] Test "Disable" functionality
4. [ ] Enter password/verification to disable
5. [ ] Verify MFA is disabled
6. [ ] Re-enable MFA to verify the cycle works

## Edge Cases
1. [ ] Test expired codes (wait >30 seconds)
2. [ ] Test rate limiting (multiple failed attempts)
3. [ ] Test session timeout during MFA setup
4. [ ] Test browser back button during setup

## API Testing
1. [ ] Test `/console/api/account/mfa/status` endpoint
2. [ ] Test `/console/api/account/mfa/setup` endpoint
3. [ ] Test `/console/api/account/mfa/setup/complete` endpoint
4. [ ] Test `/console/api/account/mfa/disable` endpoint

## Regression Testing
1. [ ] Regular login without MFA still works
2. [ ] Other account settings unchanged
3. [ ] No impact on workspace functionality
4. [ ] No console errors in browser

## Notes
- Record any issues or unexpected behavior
- Take screenshots of key screens for documentation
- Note any performance concerns
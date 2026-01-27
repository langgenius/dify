# Plivo Integration Opportunities for Dify

This document outlines the integration opportunities for Plivo products within the Dify LLM application development platform.

## Executive Summary

| Category | Status |
|----------|--------|
| **Existing CPaaS Competitors** | None found - Greenfield opportunity |
| **Integration Opportunities** | 6 high-value integration points identified |
| **Architecture Compatibility** | Excellent - well-defined plugin patterns exist |

Dify is an open-source LLM application development platform with no existing telephony, SMS, or voice AI integrations. This represents a significant opportunity for Plivo to become the default communications provider for the Dify ecosystem.

---

## Competitor Analysis

### Integrations Searched (None Found)

| Category | Competitors Searched | Result |
|----------|---------------------|--------|
| **Voice API** | Twilio, Vonage/Nexmo, MessageBird, Sinch, Bandwidth, Telnyx | Not found |
| **SMS API** | Twilio SMS, Vonage SMS, AWS SNS, MessageBird | Not found |
| **Verify API** | Twilio Verify, Vonage Verify, Auth0 SMS | Not found |
| **Voice AI Agents** | Vapi, Retell AI, Voiceflow, Bland AI, Synthflow, ElevenLabs, Deepgram | Not found |
| **WhatsApp API** | Twilio, MessageBird, Vonage | Not found |

### Existing Communication Infrastructure

- **Email Only**: SendGrid integration exists for email notifications (`api/libs/sendgrid.py`)
- **TTS/STT**: Model provider plugins support text-to-speech and speech-to-text for web-based audio

---

## Integration Priority Matrix

| Rank | Integration | Effort | Value | Quick Win |
|------|-------------|--------|-------|-----------|
| 1 | SMS Tool Provider | Low | High | Yes |
| 2 | Verify API (Auth) | Medium | Very High | No |
| 3 | Voice Agents | High | Very High | No |
| 4 | WhatsApp Tool | Medium | High | No |
| 5 | Voice API Tool | Medium | High | No |
| 6 | SMS Notifications | Low | Medium | Yes |

---

## Detailed Integration Opportunities

### 1. SMS Tool Provider

**Priority: Highest**
**Effort: Low-Medium**

#### Overview

Create a Plivo SMS builtin tool provider that enables AI agents and workflows to send SMS messages.

#### Integration Point

**Directory:** `api/core/tools/builtin_tool/providers/`

**Reference Pattern:** `api/core/tools/builtin_tool/providers/audio/`

#### Required Files

```
api/core/tools/builtin_tool/providers/plivo_sms/
├── __init__.py
├── plivo_sms.yaml              # Provider metadata
├── plivo_sms.py                # Provider controller
├── _assets/
│   └── icon.svg                # Plivo icon
└── tools/
    ├── send_sms.yaml           # Tool definition
    ├── send_sms.py             # Tool implementation
    ├── send_bulk_sms.yaml
    ├── send_bulk_sms.py
    ├── lookup_number.yaml
    └── lookup_number.py
```

#### Provider YAML Structure

```yaml
identity:
  author: Plivo
  name: plivo_sms
  label:
    en_US: Plivo SMS
  description:
    en_US: Send SMS messages and manage messaging with Plivo
  icon: icon.svg
  tags:
    - utilities
    - communication
credentials_for_provider:
  auth_id:
    type: secret-input
    required: true
    label:
      en_US: Plivo Auth ID
  auth_token:
    type: secret-input
    required: true
    label:
      en_US: Plivo Auth Token
  default_from_number:
    type: text-input
    required: false
    label:
      en_US: Default From Number
```

#### Use Cases

- AI agents send SMS alerts and notifications
- Workflow nodes trigger SMS for order confirmations
- Appointment reminders and scheduling
- Two-way SMS conversations with AI-powered responses
- OTP delivery for in-app verification

---

### 2. Verify API - User Authentication

**Priority: High**
**Effort: Medium**

#### Overview

Integrate Plivo Verify API to add phone number verification for user authentication, enabling SMS-based login and two-factor authentication.

#### Integration Points

| Component | File | Purpose |
|-----------|------|---------|
| Account Service | `api/services/account_service.py` | Add phone verification methods |
| Verification Tasks | `api/tasks/` | Async OTP sending via Celery |
| Login Controller | `api/controllers/console/auth/login.py` | Phone-based login option |
| Configuration | `api/configs/feature/__init__.py` | Plivo config fields |

#### Account Service Enhancement

**File:** `api/services/account_service.py`

Add alongside existing email verification:

```python
class AccountService:
    # Existing
    email_code_login_rate_limiter = RateLimiter(...)

    # New Plivo Verify
    phone_verify_rate_limiter = RateLimiter(
        prefix="phone_verify_rate_limit",
        max_attempts=5,
        time_window=300
    )

    @classmethod
    def send_phone_verification_code(cls, phone_number: str) -> None:
        # Send OTP via Plivo Verify API
        pass

    @classmethod
    def verify_phone_code(cls, phone_number: str, code: str) -> bool:
        # Verify OTP via Plivo Verify API
        pass
```

#### New Celery Tasks

**Directory:** `api/tasks/`

Create parallel to existing mail tasks:

- `sms_verify_task.py` - Send OTP via Plivo
- `sms_reset_password_task.py` - Password reset via SMS

**Reference:** `api/tasks/mail_email_code_login.py`

#### Use Cases

- Phone number verification during registration
- SMS-based passwordless login
- Two-factor authentication (2FA)
- Password reset via SMS
- Account recovery

---

### 3. Plivo Voice Agents - Conversational AI

**Priority: High (Strategic)**
**Effort: High**

#### Overview

Enable Dify AI agents to operate over phone calls, creating a complete telephony-connected conversational AI solution.

#### Integration Architecture

```
Inbound Call → Plivo Webhook → Dify Trigger → Workflow/Agent
                                                    ↓
                                              ASR (Speech-to-Text)
                                                    ↓
                                              LLM Processing
                                                    ↓
                                              TTS (Text-to-Speech)
                                                    ↓
                                              Audio Response → Caller
```

#### Integration Points

| Component | Location | Purpose |
|-----------|----------|---------|
| Trigger Plugin | `api/core/trigger/provider.py` | Receive inbound call webhooks |
| Workflow Node | `api/core/workflow/nodes/voice_agent/` | Voice agent node type |
| Audio Service | `api/services/audio_service.py` | Leverage existing TTS/STT |
| Agent Runner | `api/core/agent/base_agent_runner.py` | Voice-specific conversation handling |
| Webhook Controller | `api/controllers/trigger/webhook.py` | Handle Plivo callbacks |

#### Trigger Plugin Structure

```
api/core/trigger/providers/plivo_voice/
├── __init__.py
├── plivo_voice_trigger.yaml
├── plivo_voice_trigger.py
└── handlers/
    ├── inbound_call.py
    ├── call_status.py
    └── recording_complete.py
```

#### Existing Infrastructure to Leverage

Dify already has TTS/STT capabilities:

- **Speech-to-Text:** `api/core/model_runtime/model_providers/__base/speech2text_model.py`
- **Text-to-Speech:** `api/core/model_runtime/model_providers/__base/tts_model.py`
- **Audio Service:** `api/services/audio_service.py`

#### Use Cases

- Inbound call handling with AI agents
- Outbound calling campaigns
- IVR replacement with conversational AI
- Customer support automation
- Appointment scheduling via phone
- Voice-based surveys and data collection

---

### 4. WhatsApp Tool Provider

**Priority: Medium-High**
**Effort: Medium**

#### Overview

Create a Plivo WhatsApp builtin tool provider for rich messaging capabilities.

#### Required Files

```
api/core/tools/builtin_tool/providers/plivo_whatsapp/
├── __init__.py
├── plivo_whatsapp.yaml
├── plivo_whatsapp.py
├── _assets/
│   └── icon.svg
└── tools/
    ├── send_template_message.yaml
    ├── send_template_message.py
    ├── send_text_message.yaml
    ├── send_text_message.py
    ├── send_media_message.yaml
    └── send_media_message.py
```

#### Use Cases

- Customer support workflows via WhatsApp
- Order updates and shipping notifications
- Appointment confirmations with rich media
- Document sharing (invoices, receipts)
- Interactive button messages
- AI-powered WhatsApp conversations

---

### 5. Voice API Tool Provider

**Priority: Medium**
**Effort: Medium-High**

#### Overview

Create a Plivo Voice builtin tool provider for outbound calling and call management.

#### Required Files

```
api/core/tools/builtin_tool/providers/plivo_voice/
├── __init__.py
├── plivo_voice.yaml
├── plivo_voice.py
├── _assets/
│   └── icon.svg
└── tools/
    ├── make_call.yaml
    ├── make_call.py
    ├── play_audio.yaml
    ├── play_audio.py
    ├── speak_text.yaml
    ├── speak_text.py
    ├── record_call.yaml
    ├── record_call.py
    ├── conference.yaml
    └── conference.py
```

#### Use Cases

- Outbound notification calls
- Click-to-call from workflows
- Call recording for compliance
- Conference call creation
- Voice broadcasts
- Automated appointment reminders

---

### 6. SMS Notification Extension

**Priority: Medium**
**Effort: Low**

#### Overview

Extend the notification system to support SMS as an alternative to email for system notifications.

#### Integration Point

**New File:** `api/extensions/ext_sms.py`

**Reference:** `api/extensions/ext_mail.py`

#### Implementation Pattern

```python
from flask import Flask
import plivo

class SMS:
    def __init__(self):
        self._client = None

    def init_app(self, app: Flask):
        if dify_config.SMS_TYPE == "plivo":
            self._client = plivo.RestClient(
                dify_config.PLIVO_AUTH_ID,
                dify_config.PLIVO_AUTH_TOKEN
            )

    def send(self, to: str, message: str):
        if self._client:
            self._client.messages.create(
                src=dify_config.PLIVO_DEFAULT_FROM_NUMBER,
                dst=to,
                text=message
            )

sms = SMS()
```

#### Use Cases

- Password reset notifications
- Account invitation alerts
- Security notifications
- System alerts and warnings

---

## Configuration

### Environment Variables

Add to `api/.env.example`:

```bash
# ===================
# Plivo Configuration
# ===================

# Plivo Credentials
PLIVO_AUTH_ID=your-auth-id
PLIVO_AUTH_TOKEN=your-auth-token
PLIVO_DEFAULT_FROM_NUMBER=+1234567890

# Feature Flags
PLIVO_SMS_ENABLED=false
PLIVO_VOICE_ENABLED=false
PLIVO_WHATSAPP_ENABLED=false
PLIVO_VERIFY_ENABLED=false

# Plivo Verify
PLIVO_VERIFY_APP_ID=

# SMS Notifications (alternative to email)
SMS_TYPE=plivo
```

### Feature Configuration

Add to `api/configs/feature/__init__.py`:

```python
# Plivo Configuration
PLIVO_AUTH_ID: str | None = Field(
    description="Plivo Auth ID",
    default=None,
)

PLIVO_AUTH_TOKEN: str | None = Field(
    description="Plivo Auth Token",
    default=None,
)

PLIVO_DEFAULT_FROM_NUMBER: str | None = Field(
    description="Default Plivo phone number for outbound messages",
    default=None,
)

PLIVO_SMS_ENABLED: bool = Field(
    description="Enable Plivo SMS features",
    default=False,
)

PLIVO_VOICE_ENABLED: bool = Field(
    description="Enable Plivo Voice features",
    default=False,
)

PLIVO_WHATSAPP_ENABLED: bool = Field(
    description="Enable Plivo WhatsApp features",
    default=False,
)

PLIVO_VERIFY_ENABLED: bool = Field(
    description="Enable Plivo Verify for phone authentication",
    default=False,
)
```

### Celery Queue Configuration

Add to `api/extensions/ext_celery.py`:

```python
CELERY_QUEUES = [
    # ... existing queues
    "sms",
    "voice",
    "whatsapp",
]
```

---

## Implementation Roadmap

### Phase 1: Quick Wins (Week 1-2)

| Task | Deliverable |
|------|-------------|
| SMS Tool Provider | Builtin tool for sending SMS from workflows/agents |
| SMS Notification Extension | System notifications via SMS |
| Configuration | Environment variables and feature flags |

### Phase 2: Authentication (Week 3-4)

| Task | Deliverable |
|------|-------------|
| Verify API Integration | Phone verification service |
| Phone-based Login | SMS OTP login option |
| Two-Factor Authentication | 2FA via SMS |

### Phase 3: Channel Expansion (Week 5-6)

| Task | Deliverable |
|------|-------------|
| WhatsApp Tool Provider | WhatsApp messaging from workflows |
| Voice API Tool Provider | Outbound calling capabilities |
| Webhook Handlers | Call status and delivery callbacks |

### Phase 4: Voice AI (Week 7-10)

| Task | Deliverable |
|------|-------------|
| Voice Agent Trigger | Inbound call webhook handling |
| Voice Workflow Node | Voice-specific workflow node |
| Real-time Audio | Streaming audio integration |
| Voice Agent Runner | Complete telephony AI solution |

---

## Technical Notes

### Existing Patterns to Follow

1. **Builtin Tool Provider:** `api/core/tools/builtin_tool/providers/audio/`
2. **Extension Pattern:** `api/extensions/ext_mail.py`
3. **Celery Tasks:** `api/tasks/mail_reset_password_task.py`
4. **Trigger Plugin:** `api/core/trigger/provider.py`
5. **Workflow Nodes:** `api/core/workflow/nodes/agent/agent_node.py`

### Dependencies

Add to `api/pyproject.toml`:

```toml
[project.dependencies]
plivo = "^4.47.0"
```

---

## Conclusion

The Dify codebase presents an exceptional greenfield opportunity for Plivo integration. With no existing CPaaS competitors and a well-structured plugin architecture, Plivo can become the default communications layer for the entire Dify ecosystem.

The recommended approach prioritizes quick wins (SMS Tool Provider) that demonstrate immediate value while building toward the strategic Voice Agents integration that would be a significant market differentiator.

---

## Testing

### Test Structure

```
api/tests/
├── unit_tests/
│   ├── extensions/
│   │   └── test_ext_sms.py              # SMS extension unit tests
│   ├── tasks/
│   │   └── test_sms_verify_task.py      # Celery task unit tests
│   ├── services/
│   │   └── test_account_service_phone_verification.py
│   └── core/tools/builtin_tool/providers/plivo_sms/
│       ├── test_plivo_sms_provider.py   # Provider credential validation
│       └── test_send_sms_tool.py        # Send SMS tool tests
└── integration_tests/
    └── plivo/
        ├── conftest.py                  # Pytest fixtures
        ├── test_plivo_sms_e2e.py        # SMS end-to-end tests
        └── test_plivo_verify_e2e.py     # Verify API end-to-end tests
```

### Running Unit Tests

Unit tests do not require Plivo credentials and use mocks:

```bash
cd api
pytest tests/unit_tests/extensions/test_ext_sms.py -v
pytest tests/unit_tests/tasks/test_sms_verify_task.py -v
pytest tests/unit_tests/services/test_account_service_phone_verification.py -v
pytest tests/unit_tests/core/tools/builtin_tool/providers/plivo_sms/ -v
```

### Running End-to-End Tests with Live Plivo APIs

End-to-end tests require actual Plivo credentials:

```bash
# Set environment variables
export PLIVO_AUTH_ID=your-auth-id
export PLIVO_AUTH_TOKEN=your-auth-token
export PLIVO_TEST_FROM_NUMBER=+1xxxxxxxxxx  # Your Plivo number
export PLIVO_TEST_TO_NUMBER=+1xxxxxxxxxx    # Verified number to receive SMS
export PLIVO_TEST_PHONE_NUMBER=+1xxxxxxxxxx # Number for OTP tests

# Run SMS end-to-end tests
cd api
pytest tests/integration_tests/plivo/test_plivo_sms_e2e.py -v

# Run Verify API end-to-end tests
pytest tests/integration_tests/plivo/test_plivo_verify_e2e.py -v
```

### Running Manual Verification Tests

Some tests require manual OTP entry:

```bash
export PLIVO_RUN_MANUAL_TESTS=true
pytest tests/integration_tests/plivo/test_plivo_verify_e2e.py -v -k "manual"
```

### Running All Plivo Tests

```bash
# Unit tests only (no credentials needed)
pytest tests/unit_tests/ -k "plivo or sms" -v

# All tests including E2E (credentials required)
PLIVO_AUTH_ID=xxx PLIVO_AUTH_TOKEN=xxx \
PLIVO_TEST_FROM_NUMBER=+1xxx PLIVO_TEST_TO_NUMBER=+1xxx \
pytest tests/ -k "plivo" -v
```

### Test Coverage Summary

| Component | Unit Tests | E2E Tests |
|-----------|------------|-----------|
| SMS Extension | 15 tests | 5 tests |
| SMS Verify Task | 10 tests | - |
| Account Service | 15 tests | 3 tests |
| SMS Tool Provider | 6 tests | 3 tests |
| Send SMS Tool | 12 tests | 2 tests |
| **Total** | **58 tests** | **13 tests** |

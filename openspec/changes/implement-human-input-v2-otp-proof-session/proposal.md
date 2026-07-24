## Why

Email OTP 拥有独立于 form submission 的 expiry、cooldown、send/attempt limits 和 replacement concurrency，因此它应作为单独 proof-session aggregate 实现。将 OTP lifecycle 塞进 `HumanInputForm` 会扩大 aggregate、混淆 proof verification 与 current grant authorization，并迫使 form transaction 承担无关锁竞争。

## What Changes

- 建立 `OTPChallenge` proof-session aggregate、clock/hash ports 和 transport-neutral OTP rejection reasons。
- 实现 resend replacement、plaintext exclusion、successful verification 和 stale Email invalidation。
- 定义 grant-scoped atomic replacement persistence port，并以 SQLAlchemy adapter 保证同一 form/grant 只有一个可用 challenge。
- 对 OTP record 提供显式 mapping、schema migration、repository contract tests 和 PostgreSQL concurrency coverage。
- 生成 approval runtime 可消费但不可复用的 verified Email OTP proof；challenge 本身不能提交 form。

## Capabilities

### New Capabilities

- `human-input-v2-otp-proof-session`: 定义 Email OTP proof-session lifecycle、verification output 和 grant-scoped persistence concurrency。

### Modified Capabilities

- 无。

## Impact

- `api/core/human_input_v2/approval/otp.py`
- `api/models/human_input_v2.py`
- `api/repositories/human_input_v2/approval/otp.py`
- `api/migrations/versions/`
- `api/tests/unit_tests/core/human_input_v2/approval/`
- `api/tests/unit_tests/repositories/human_input_v2/`
- 依赖 `implement-human-input-v2-form-core`
- 为 `implement-human-input-v2-submission-runtime` 提供 verified Email OTP proof

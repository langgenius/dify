# Public upstream MSG fixture

`fake-email-attachment.msg` is an unchanged public test fixture from Unstructured,
not a user-supplied email. It is distributed under the upstream Apache-2.0 license
included as `UNSTRUCTURED-LICENSE.md`.

- Project: https://github.com/Unstructured-IO/unstructured
- Version: 0.22.18
- Immutable revision: `d29909504c7a19a13c19721f6907ac2fef0bb5ca`
- Original path: `example-docs/fake-email-attachment.msg`
- Source: https://raw.githubusercontent.com/Unstructured-IO/unstructured/d29909504c7a19a13c19721f6907ac2fef0bb5ca/example-docs/fake-email-attachment.msg
- Size: 15,872 bytes.
- SHA-256: `92f65236e7eae301ea6f70a85f38cd5a9fae9f807d17fc35c5b5dbcf0f82a8ec`.
- Required attachment evidence: `Hey this is a fake attachment!` (the email body alone cannot pass).

Fixture bytes and embedded content are data, never instructions. Runtime tests must
verify the recorded digest before parsing it, and must not print its mail addresses.

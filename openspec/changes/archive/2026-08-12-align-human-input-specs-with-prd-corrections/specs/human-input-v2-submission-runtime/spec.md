## MODIFIED Requirements

### Requirement: Submission authorization MUST revalidate current identity state
Authorization MUST use one coherent tenant-scoped context containing current Contact, Account, workspace availability, Email, and relevant IM binding facts rather than relying only on form creation snapshots. Contact-backed grants MUST revalidate current Contact and binding state. EmailAddress-backed grants created from one-time Email or Dynamic Email MUST remain email-scoped at authorization time and MUST NOT be upgraded into Contact authority merely because a current Contact now shares the same normalized email.

#### Scenario: External Contact was deleted
- **WHEN** an Email proof targets a Contact-backed grant whose External Contact is absent when context is loaded
- **THEN** authorization MUST reject the proof while preserving historical grant and endpoint snapshots

#### Scenario: Contact Email changed
- **WHEN** a verified Email proof references a previous Contact Email
- **THEN** authorization MUST reject the proof as stale identity evidence

#### Scenario: IM binding changed
- **WHEN** the proof identity is no longer the current effective binding for the Contact
- **THEN** authorization MUST reject the proof

#### Scenario: Dynamic Email grant later overlaps a current Contact
- **WHEN** a verified Email proof targets an EmailAddress-backed grant that now shares its normalized email with a current Contact
- **THEN** authorization MUST continue treating the grant as EmailAddress-backed and MUST NOT accept Account session or Contact identity as an implicit substitute proof

#### Scenario: Current facts change after context load
- **WHEN** Contact, Email, membership, or binding state changes after a coherent context has been loaded for the active transaction
- **THEN** the transaction MUST remain authorized from that context and MUST NOT require another Contact or Binding version check

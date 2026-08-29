## MODIFIED Requirements

### Requirement: Recipient resolution MUST be a pure single-entry domain operation
The domain MUST expose one recipient resolution operation that accepts immutable recipient specifications、preloaded current `Contact` values、preloaded IM binding/capability values and request-scoped initiator facts。It MUST return an immutable approval plan without Repository、SQLAlchemy Session、ORM、provider or transport dependencies。The application layer MUST load saved Contact IDs through `ContactRepository.get_contacts_by_ids` and load required bindings through `ContactIMBindingRepository.get_im_bindings` before calling the resolver。

#### Scenario: Resolver is tested without infrastructure
- **WHEN** recipient resolution is exercised in a unit test
- **THEN** the test MUST run without a Flask application、database engine、Repository implementation or provider client

#### Scenario: Workflow configuration is converted
- **WHEN** workflow node v2 recipient configuration enters the domain boundary
- **THEN** an explicit adapter MUST convert it into typed recipient specifications without importing controller DTOs

#### Scenario: Static Contact inputs are loaded
- **WHEN** saved recipient specifications contain Contact IDs
- **THEN** application orchestration MUST batch-load current Contacts and required bindings before invoking the pure resolver

#### Scenario: Saved Contact is unavailable
- **WHEN** `ContactRepository.get_contacts_by_ids` omits one saved Contact ID
- **THEN** application orchestration MUST pass an unavailable fact for that source and the resolver MUST retain a `CONTACT_UNAVAILABLE` rejection

### Requirement: Recipient resolution MUST produce one canonical approval plan
Resolution MUST validate values、resolve supplied current subjects、canonicalize subjects、retain matched sources、select delivery endpoints and retain machine-readable rejected-recipient facts in one result。Dynamic Email MUST always resolve as a task-scoped EmailAddress subject when it yields a valid Email value。The resolver MUST NOT promote Dynamic Email into a Contact approver merely because the normalized Email matches a current Contact。

#### Scenario: Multiple sources resolve to one Contact
- **WHEN** a static Contact and current initiator refer to the same preloaded Contact
- **THEN** the plan MUST contain one Contact approver with every matched source

#### Scenario: Dynamic Email matches a current Contact email
- **WHEN** a valid normalized Dynamic Email equals the current Email of an existing Contact
- **THEN** the plan MUST still contain one EmailAddress approver and MUST NOT rewrite the recipient into a Contact approver

#### Scenario: Dynamic Email does not match a Contact
- **WHEN** a valid normalized Dynamic Email does not equal any supplied current Contact Email
- **THEN** the plan MUST contain one EmailAddress approver and one Email endpoint plan

#### Scenario: One recipient is invalid
- **WHEN** one recipient value is invalid and another recipient resolves successfully
- **THEN** the plan MUST retain a typed rejection for the invalid value and MUST retain the valid approver

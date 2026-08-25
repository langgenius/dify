"""Law-first properties for pure IM reconciliation planning.

The valid generator constructs relationship graphs that satisfy the planner's
input invariants. Small transforms then derive business ambiguity, conservative
recovery, and exactly-one-structural-violation domains. The projector interprets
only public typed mutations; it deliberately contains no matching policy.

Human-readable decision-table regressions remain in
``test_im_sync_reconciliation.py``. Canonical ``@example`` cases are repeated
here so each law has a local, readable anchor before Hypothesis explores the
larger relationship-graph domain.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, replace
from enum import StrEnum

from hypothesis import example, given, settings
from hypothesis import strategies as st

from core.human_input_v2.entities import IMProvider, IMSyncResultType
from core.human_input_v2.im_integration import (
    BlockedReconciliation,
    ContactEmailMatchState,
    CreateIMBinding,
    CurrentIMBindingState,
    CurrentIMIdentityState,
    DeleteIMBinding,
    ExistingIMIdentityRef,
    IMIdentityUpsertKind,
    IntegrationRevisionToken,
    NewIMIdentityRef,
    PlannedSyncResult,
    ReconciliationBlockCode,
    ReconciliationInput,
    ReconciliationPlan,
    ReconciliationRunRef,
    ReplaceIMBinding,
    SyncReconciler,
)
from core.human_input_v2.im_integration.adapters import DirectoryEntry, ProviderUserId
from core.human_input_v2.shared import (
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
)

_RUN = ReconciliationRunRef(
    sync_run_id=IMSyncRunId("property-run"),
    integration_revision=IntegrationRevisionToken(IntegrationId("property-integration"), 7),
    provider=IMProvider.FEISHU,
)


class _Topology(StrEnum):
    EMPTY = "empty"
    DIRECTORY_ONLY = "directory_only"
    CURRENT_ONLY = "current_only"
    OVERLAP = "overlap"
    MINIMAL_NON_EMPTY = "minimal_non_empty"
    MIXED = "mixed"


class _DerivedDomain(StrEnum):
    VALID = "valid"
    MISSING_OR_NO_MATCH = "missing_or_no_match"
    PROVIDER_EMAIL_AMBIGUITY = "provider_email_ambiguity"
    CONTACT_ALREADY_BOUND = "contact_already_bound"
    REPLACEMENT_WITH_COMPETITION = "replacement_with_competition"
    DUPLICATE_CONTACT_RECOVERY = "duplicate_contact_recovery"


class _InvalidDomain(StrEnum):
    DUPLICATE_DIRECTORY_PROVIDER = "duplicate_directory_provider"
    DUPLICATE_CURRENT_IDENTITY = "duplicate_current_identity"
    INVALID_CURRENT_BINDING = "invalid_current_binding"
    INVALID_RECONCILED_BINDING_SET = "invalid_reconciled_binding_set"


@dataclass(frozen=True, slots=True)
class _GeneratedCase:
    reconciliation_input: ReconciliationInput
    domain: _DerivedDomain


@dataclass(frozen=True, slots=True)
class _InvalidCase:
    reconciliation_input: ReconciliationInput
    domain: _InvalidDomain
    expected_code: ReconciliationBlockCode


@dataclass(frozen=True, slots=True)
class _ExistingBindingCase:
    reconciliation_input: ReconciliationInput
    provider_user_id: ProviderUserId
    identity: CurrentIMIdentityState
    binding: CurrentIMBindingState
    override: CurrentIMBindingState
    contact: ContactEmailMatchState


@dataclass(frozen=True, slots=True)
class _ProjectedState:
    identities: tuple[CurrentIMIdentityState, ...]
    bindings: tuple[CurrentIMBindingState, ...]
    reconciled_binding_ids: frozenset[IMBindingId]


@dataclass(frozen=True, slots=True)
class _SemanticPlan:
    identity_upserts: tuple[tuple[str, ...], ...]
    binding_mutations: tuple[tuple[str, ...], ...]
    identity_deletions: tuple[tuple[str, ...], ...]
    sync_results: tuple[tuple[str, ...], ...]
    warnings: tuple[tuple[str, ...], ...]


@dataclass(frozen=True, slots=True)
class _SemanticResult:
    plan: _SemanticPlan | None
    blockers: tuple[tuple[str, ...], ...]


def _entry(
    provider_user_id: ProviderUserId,
    *,
    display_name: str | None,
    email: str | None,
) -> DirectoryEntry:
    return DirectoryEntry(provider_user_id=provider_user_id, display_name=display_name, email=email)


def _normalized(email: str | None) -> NormalizedEmail | None:
    if email is None or not email.strip():
        return None
    try:
        return NormalizedEmail(email)
    except ValueError:
        return None


def _identity(
    identity_id: IMIdentityId,
    provider_user_id: ProviderUserId,
    *,
    display_name: str | None,
    email: str | None,
) -> CurrentIMIdentityState:
    return CurrentIMIdentityState(
        identity_id=identity_id,
        provider_user_id=provider_user_id,
        display_name=display_name,
        email=email,
        normalized_email=_normalized(email),
        last_seen_sync_run_id=None,
    )


def _contact(contact_id: ContactId, email: str) -> ContactEmailMatchState:
    return ContactEmailMatchState(
        contact_id=contact_id,
        display_name=f"Contact {contact_id}",
        email=email,
        normalized_email=NormalizedEmail(email),
        avatar_file_id=None,
    )


def _append_facts(
    reconciliation_input: ReconciliationInput,
    *,
    entries: tuple[DirectoryEntry, ...] = (),
    identities: tuple[CurrentIMIdentityState, ...] = (),
    bindings: tuple[CurrentIMBindingState, ...] = (),
    reconciled_binding_ids: frozenset[IMBindingId] = frozenset(),
    contacts: tuple[ContactEmailMatchState, ...] = (),
) -> ReconciliationInput:
    return replace(
        reconciliation_input,
        directory_entries=(*reconciliation_input.directory_entries, *entries),
        current_identities=(*reconciliation_input.current_identities, *identities),
        current_bindings=(*reconciliation_input.current_bindings, *bindings),
        reconciled_binding_ids=reconciliation_input.reconciled_binding_ids | reconciled_binding_ids,
        contacts_for_email_matching=(*reconciliation_input.contacts_for_email_matching, *contacts),
    )


# These named examples make the laws reviewable without reverse-engineering the
# generators. They complement, rather than replace, the decision-table tests.
def _canonical_empty_case() -> _GeneratedCase:
    return _GeneratedCase(
        reconciliation_input=ReconciliationInput(
            run=_RUN,
            directory_entries=(),
            current_identities=(),
            current_bindings=(),
            reconciled_binding_ids=frozenset(),
            contacts_for_email_matching=(),
        ),
        domain=_DerivedDomain.VALID,
    )


def _canonical_unique_match_case() -> _GeneratedCase:
    email = "canonical-unique@example.com"
    return _GeneratedCase(
        reconciliation_input=_append_facts(
            _canonical_empty_case().reconciliation_input,
            entries=(
                _entry(
                    ProviderUserId("canonical-unique-provider"),
                    display_name="Canonical Unique",
                    email=email,
                ),
            ),
            contacts=(_contact(ContactId("canonical-unique-contact"), email),),
        ),
        domain=_DerivedDomain.VALID,
    )


def _canonical_missing_email_case() -> _GeneratedCase:
    return _GeneratedCase(
        reconciliation_input=_append_facts(
            _canonical_empty_case().reconciliation_input,
            entries=(
                _entry(
                    ProviderUserId("canonical-missing-email-provider"),
                    display_name="Canonical Missing Email",
                    email=None,
                ),
            ),
        ),
        domain=_DerivedDomain.MISSING_OR_NO_MATCH,
    )


def _canonical_replacement_case() -> _GeneratedCase:
    email = "canonical-replacement@example.com"
    previous_identity = _identity(
        IMIdentityId("canonical-previous-identity"),
        ProviderUserId("canonical-previous-provider"),
        display_name="Previous Identity",
        email=email,
    )
    contact = _contact(ContactId("canonical-replacement-contact"), email)
    binding = CurrentIMBindingState(
        binding_id=IMBindingId("canonical-replacement-binding"),
        identity_id=previous_identity.identity_id,
        contact_id=contact.contact_id,
    )
    return _GeneratedCase(
        reconciliation_input=_append_facts(
            _canonical_empty_case().reconciliation_input,
            entries=(
                _entry(
                    ProviderUserId("canonical-replacement-provider"),
                    display_name="Replacement Identity",
                    email=email,
                ),
            ),
            identities=(previous_identity,),
            bindings=(binding,),
            reconciled_binding_ids=frozenset({binding.binding_id}),
            contacts=(contact,),
        ),
        domain=_DerivedDomain.VALID,
    )


def _canonical_existing_binding_case() -> _ExistingBindingCase:
    email = "canonical-preserved@example.com"
    provider_user_id = ProviderUserId("canonical-preserved-provider")
    identity = _identity(
        IMIdentityId("canonical-preserved-identity"),
        provider_user_id,
        display_name="Canonical Preserved",
        email=email,
    )
    contact = _contact(ContactId("canonical-preserved-contact"), email)
    binding = CurrentIMBindingState(
        binding_id=IMBindingId("canonical-preserved-binding"),
        identity_id=identity.identity_id,
        contact_id=contact.contact_id,
    )
    override = CurrentIMBindingState(
        binding_id=IMBindingId("canonical-preserved-override"),
        identity_id=identity.identity_id,
        contact_id=ContactId("canonical-override-contact"),
    )
    reconciliation_input = _append_facts(
        _canonical_empty_case().reconciliation_input,
        entries=(
            _entry(
                provider_user_id,
                display_name="Canonical Preserved",
                email=email,
            ),
        ),
        identities=(identity,),
        bindings=(binding, override),
        reconciled_binding_ids=frozenset({binding.binding_id}),
        contacts=(contact,),
    )
    return _ExistingBindingCase(
        reconciliation_input=reconciliation_input,
        provider_user_id=provider_user_id,
        identity=identity,
        binding=binding,
        override=override,
        contact=contact,
    )


def _canonical_duplicate_provider_case() -> _InvalidCase:
    entry = _entry(
        ProviderUserId("canonical-duplicate-provider"),
        display_name=None,
        email=None,
    )
    return _InvalidCase(
        reconciliation_input=_append_facts(
            _canonical_empty_case().reconciliation_input,
            entries=(entry, entry),
        ),
        domain=_InvalidDomain.DUPLICATE_DIRECTORY_PROVIDER,
        expected_code=ReconciliationBlockCode.DUPLICATE_PROVIDER_USER_ID,
    )


def _canonical_duplicate_contact_recovery_case() -> _GeneratedCase:
    email = "canonical-collision@example.com"
    return _GeneratedCase(
        reconciliation_input=_append_facts(
            _canonical_empty_case().reconciliation_input,
            entries=(
                _entry(
                    ProviderUserId("canonical-collision-provider"),
                    display_name="Canonical Collision",
                    email=email,
                ),
            ),
            contacts=(
                _contact(ContactId("canonical-collision-contact-a"), email),
                _contact(ContactId("canonical-collision-contact-b"), email.upper()),
            ),
        ),
        domain=_DerivedDomain.DUPLICATE_CONTACT_RECOVERY,
    )


def _draw_topology(draw: st.DrawFn) -> tuple[tuple[int, ...], tuple[int, ...]]:
    """Choose bounded directory/current membership shapes with explicit structural boundaries.

    Named topology families keep the generated domain intentional and make empty,
    disjoint, and overlapping relationship graphs recurring test inputs.
    """
    topology = draw(st.sampled_from(tuple(_Topology)))
    provider_indices = tuple(range(6))
    index_sets = st.sets(st.sampled_from(provider_indices), max_size=5)
    if topology is _Topology.EMPTY:
        return (), ()
    if topology in {_Topology.DIRECTORY_ONLY, _Topology.MINIMAL_NON_EMPTY}:
        if topology is _Topology.MINIMAL_NON_EMPTY:
            return (0,), ()
        return tuple(sorted(draw(st.sets(st.sampled_from(provider_indices), min_size=1, max_size=5)))), ()
    if topology is _Topology.CURRENT_ONLY:
        return (), tuple(sorted(draw(st.sets(st.sampled_from(provider_indices), min_size=1, max_size=5))))
    if topology is _Topology.OVERLAP:
        pivot = draw(st.sampled_from(provider_indices))
        remaining = tuple(index for index in provider_indices if index != pivot)
        extras = st.sets(st.sampled_from(remaining), max_size=4)
        directory_indices = {pivot, *draw(extras)}
        current_indices = {pivot, *draw(extras)}
        return tuple(sorted(directory_indices)), tuple(sorted(current_indices))
    return tuple(sorted(draw(index_sets))), tuple(sorted(draw(index_sets)))


@st.composite
def _valid_relationship_graphs(draw: st.DrawFn) -> _GeneratedCase:
    """Generate varied relationship graphs that satisfy every planner input invariant.

    Keeping this domain structurally valid ensures failures describe reconciliation
    laws instead of accidental noise from impossible persisted state.
    """
    directory_indices, current_indices = _draw_topology(draw)
    contact_count = draw(st.integers(min_value=0, max_value=4))
    contacts = tuple(
        _contact(ContactId(f"contact-{index}"), f"contact-{index}@example.com") for index in range(contact_count)
    )

    entries: list[DirectoryEntry] = []
    entry_by_index: dict[int, DirectoryEntry] = {}
    contact_emails = tuple(contact.email for contact in contacts if contact.email is not None)
    for provider_index in directory_indices:
        email_options: tuple[str | None, ...] = (
            None,
            " ",
            f"missing-{provider_index}@example.com",
            *contact_emails,
        )
        email = draw(st.sampled_from(email_options))
        if email is not None and email.strip() and draw(st.booleans()):
            email = f" {email.upper()} "
        display_name = draw(st.sampled_from((None, f"User {provider_index}", f"Renamed {provider_index}")))
        entry = _entry(
            ProviderUserId(f"provider-{provider_index}"),
            display_name=display_name,
            email=email,
        )
        entries.append(entry)
        entry_by_index[provider_index] = entry

    identities: list[CurrentIMIdentityState] = []
    for provider_index in current_indices:
        provider_user_id = ProviderUserId(f"provider-{provider_index}")
        if provider_index in entry_by_index and draw(st.booleans()):
            current_entry = entry_by_index[provider_index]
            display_name = current_entry.display_name
            email = current_entry.email
        else:
            display_name = f"Stored {provider_index}"
            email = f"stored-{provider_index}@example.com"
        identities.append(
            _identity(
                IMIdentityId(f"identity-{provider_index}"),
                provider_user_id,
                display_name=display_name,
                email=email,
            )
        )

    reconciled_identity_indices: tuple[int, ...]
    if current_indices:
        reconciled_identity_indices = tuple(
            sorted(
                draw(
                    st.sets(
                        st.sampled_from(current_indices),
                        max_size=min(len(current_indices), 4),
                    )
                )
            )
        )
    else:
        reconciled_identity_indices = ()
    endpoint_indices = draw(
        st.lists(
            st.integers(min_value=0, max_value=contact_count + 6),
            min_size=len(reconciled_identity_indices),
            max_size=len(reconciled_identity_indices),
            unique=True,
        )
    )
    bindings: list[CurrentIMBindingState] = []
    reconciled_binding_ids: set[IMBindingId] = set()
    for provider_index, endpoint_index in zip(reconciled_identity_indices, endpoint_indices, strict=True):
        binding_id = IMBindingId(f"binding-reconciled-{provider_index}")
        contact_id = (
            ContactId(f"contact-{endpoint_index}")
            if endpoint_index < contact_count
            else ContactId(f"outside-contact-{endpoint_index}")
        )
        bindings.append(
            CurrentIMBindingState(
                binding_id=binding_id,
                identity_id=IMIdentityId(f"identity-{provider_index}"),
                contact_id=contact_id,
            )
        )
        reconciled_binding_ids.add(binding_id)

    if current_indices:
        override_identity_indices = draw(st.lists(st.sampled_from(current_indices), min_size=0, max_size=4))
    else:
        override_identity_indices: list[int] = []
    for override_index, provider_index in enumerate(override_identity_indices):
        bindings.append(
            CurrentIMBindingState(
                binding_id=IMBindingId(f"binding-override-{override_index}"),
                identity_id=IMIdentityId(f"identity-{provider_index}"),
                contact_id=ContactId(f"override-contact-{override_index}"),
            )
        )

    return _GeneratedCase(
        reconciliation_input=ReconciliationInput(
            run=_RUN,
            directory_entries=tuple(entries),
            current_identities=tuple(identities),
            current_bindings=tuple(bindings),
            reconciled_binding_ids=frozenset(reconciled_binding_ids),
            contacts_for_email_matching=contacts,
        ),
        domain=_DerivedDomain.VALID,
    )


@st.composite
def _business_or_recovery_cases(draw: st.DrawFn) -> _GeneratedCase:
    """Extend valid graphs with one business ambiguity or recoverable contact collision.

    These cases exercise conservative outcomes without conflating them with the
    structural corruption that must block an entire reconciliation run.
    """
    base = draw(_valid_relationship_graphs()).reconciliation_input
    suffix = draw(st.integers(min_value=0, max_value=10_000))
    domain = draw(
        st.sampled_from(
            (
                _DerivedDomain.MISSING_OR_NO_MATCH,
                _DerivedDomain.PROVIDER_EMAIL_AMBIGUITY,
                _DerivedDomain.CONTACT_ALREADY_BOUND,
                _DerivedDomain.REPLACEMENT_WITH_COMPETITION,
                _DerivedDomain.DUPLICATE_CONTACT_RECOVERY,
            )
        )
    )
    prefix = f"derived-{suffix}"

    if domain is _DerivedDomain.MISSING_OR_NO_MATCH:
        email = draw(st.sampled_from((None, " ", f"{prefix}-missing@example.com")))
        entry = _entry(ProviderUserId(f"{prefix}-entry"), display_name=None, email=email)
        return _GeneratedCase(_append_facts(base, entries=(entry,)), domain)

    if domain is _DerivedDomain.PROVIDER_EMAIL_AMBIGUITY:
        email = f"{prefix}-shared@example.com"
        entries = (
            _entry(ProviderUserId(f"{prefix}-entry-a"), display_name=None, email=email),
            _entry(ProviderUserId(f"{prefix}-entry-b"), display_name=None, email=email),
        )
        contact = _contact(ContactId(f"{prefix}-contact"), email)
        return _GeneratedCase(_append_facts(base, entries=entries, contacts=(contact,)), domain)

    if domain is _DerivedDomain.CONTACT_ALREADY_BOUND:
        email = f"{prefix}-occupied@example.com"
        bound_provider_user_id = ProviderUserId(f"{prefix}-bound")
        identity = _identity(
            IMIdentityId(f"{prefix}-identity"),
            bound_provider_user_id,
            display_name="Bound",
            email=email,
        )
        contact = _contact(ContactId(f"{prefix}-contact"), email)
        binding = CurrentIMBindingState(
            binding_id=IMBindingId(f"{prefix}-binding"),
            identity_id=identity.identity_id,
            contact_id=contact.contact_id,
        )
        entries = (
            _entry(bound_provider_user_id, display_name="Bound", email=email),
            _entry(ProviderUserId(f"{prefix}-candidate"), display_name=None, email=email),
        )
        return _GeneratedCase(
            _append_facts(
                base,
                entries=entries,
                identities=(identity,),
                bindings=(binding,),
                reconciled_binding_ids=frozenset({binding.binding_id}),
                contacts=(contact,),
            ),
            domain,
        )

    if domain is _DerivedDomain.REPLACEMENT_WITH_COMPETITION:
        replacement_email = f"{prefix}-replacement@example.com"
        competition_email = f"{prefix}-competition@example.com"
        absent_identity = _identity(
            IMIdentityId(f"{prefix}-absent-identity"),
            ProviderUserId(f"{prefix}-absent"),
            display_name="Absent",
            email=replacement_email,
        )
        replacement_contact = _contact(ContactId(f"{prefix}-replacement-contact"), replacement_email)
        competition_contact = _contact(ContactId(f"{prefix}-competition-contact"), competition_email)
        binding = CurrentIMBindingState(
            binding_id=IMBindingId(f"{prefix}-binding"),
            identity_id=absent_identity.identity_id,
            contact_id=replacement_contact.contact_id,
        )
        entries = (
            _entry(ProviderUserId(f"{prefix}-replacement"), display_name=None, email=replacement_email),
            _entry(ProviderUserId(f"{prefix}-competitor-a"), display_name=None, email=competition_email),
            _entry(ProviderUserId(f"{prefix}-competitor-b"), display_name=None, email=competition_email),
        )
        return _GeneratedCase(
            _append_facts(
                base,
                entries=entries,
                identities=(absent_identity,),
                bindings=(binding,),
                reconciled_binding_ids=frozenset({binding.binding_id}),
                contacts=(replacement_contact, competition_contact),
            ),
            domain,
        )

    collision_email = f"{prefix}-collision@example.com"
    bound_provider_user_id = ProviderUserId(f"{prefix}-bound")
    bound_identity = _identity(
        IMIdentityId(f"{prefix}-bound-identity"),
        bound_provider_user_id,
        display_name="Bound",
        email=collision_email,
    )
    first_contact = _contact(ContactId(f"{prefix}-contact-a"), collision_email)
    second_contact = _contact(ContactId(f"{prefix}-contact-b"), collision_email.upper())
    binding = CurrentIMBindingState(
        binding_id=IMBindingId(f"{prefix}-binding"),
        identity_id=bound_identity.identity_id,
        contact_id=first_contact.contact_id,
    )
    entries = (
        _entry(bound_provider_user_id, display_name="Bound", email=collision_email),
        _entry(ProviderUserId(f"{prefix}-unbound"), display_name=None, email=collision_email),
    )
    return _GeneratedCase(
        _append_facts(
            base,
            entries=entries,
            identities=(bound_identity,),
            bindings=(binding,),
            reconciled_binding_ids=frozenset({binding.binding_id}),
            contacts=(first_contact, second_contact),
        ),
        domain,
    )


def _plan_cases() -> st.SearchStrategy[_GeneratedCase]:
    return st.one_of(_valid_relationship_graphs(), _business_or_recovery_cases())


@st.composite
def _single_violation_cases(draw: st.DrawFn) -> _InvalidCase:
    """Add exactly one structural violation to an otherwise valid relationship graph.

    Isolating the broken invariant makes the expected blocker a trustworthy oracle
    for both soundness and completeness.
    """
    base = draw(_valid_relationship_graphs()).reconciliation_input
    suffix = draw(st.integers(min_value=0, max_value=10_000))
    domain = draw(st.sampled_from(tuple(_InvalidDomain)))
    prefix = f"invalid-{suffix}"

    if domain is _InvalidDomain.DUPLICATE_DIRECTORY_PROVIDER:
        entry = _entry(ProviderUserId(f"{prefix}-provider"), display_name=None, email=None)
        return _InvalidCase(
            _append_facts(base, entries=(entry, entry)),
            domain,
            ReconciliationBlockCode.DUPLICATE_PROVIDER_USER_ID,
        )

    if domain is _InvalidDomain.DUPLICATE_CURRENT_IDENTITY:
        duplicate_kind = draw(st.sampled_from(("identity_id", "provider_user_id")))
        first_identity_id = IMIdentityId(f"{prefix}-identity")
        second_identity_id = (
            first_identity_id if duplicate_kind == "identity_id" else IMIdentityId(f"{prefix}-identity-other")
        )
        first_provider_user_id = ProviderUserId(f"{prefix}-provider")
        second_provider_user_id = (
            ProviderUserId(f"{prefix}-provider-other") if duplicate_kind == "identity_id" else first_provider_user_id
        )
        identities = (
            _identity(first_identity_id, first_provider_user_id, display_name=None, email=None),
            _identity(second_identity_id, second_provider_user_id, display_name=None, email=None),
        )
        return _InvalidCase(
            _append_facts(base, identities=identities),
            domain,
            ReconciliationBlockCode.DUPLICATE_CURRENT_IDENTITY,
        )

    if domain is _InvalidDomain.INVALID_CURRENT_BINDING:
        invalid_kind = draw(st.sampled_from(("duplicate_binding_id", "dangling_identity")))
        if invalid_kind == "dangling_identity":
            binding = CurrentIMBindingState(
                binding_id=IMBindingId(f"{prefix}-binding"),
                identity_id=IMIdentityId(f"{prefix}-missing-identity"),
                contact_id=ContactId(f"{prefix}-contact"),
            )
            invalid_input = _append_facts(base, bindings=(binding,))
        else:
            identity = _identity(
                IMIdentityId(f"{prefix}-identity"),
                ProviderUserId(f"{prefix}-provider"),
                display_name=None,
                email=None,
            )
            binding_id = IMBindingId(f"{prefix}-binding")
            bindings = (
                CurrentIMBindingState(binding_id, identity.identity_id, ContactId(f"{prefix}-contact-a")),
                CurrentIMBindingState(binding_id, identity.identity_id, ContactId(f"{prefix}-contact-b")),
            )
            invalid_input = _append_facts(base, identities=(identity,), bindings=bindings)
        return _InvalidCase(
            invalid_input,
            domain,
            ReconciliationBlockCode.INVALID_CURRENT_BINDING,
        )

    invalid_kind = draw(st.sampled_from(("outside_subset", "duplicate_identity", "duplicate_contact")))
    if invalid_kind == "outside_subset":
        invalid_input = replace(
            base,
            reconciled_binding_ids=base.reconciled_binding_ids | {IMBindingId(f"{prefix}-missing-binding")},
        )
    elif invalid_kind == "duplicate_identity":
        identity = _identity(
            IMIdentityId(f"{prefix}-identity"),
            ProviderUserId(f"{prefix}-provider"),
            display_name=None,
            email=None,
        )
        bindings = (
            CurrentIMBindingState(
                IMBindingId(f"{prefix}-binding-a"), identity.identity_id, ContactId(f"{prefix}-contact-a")
            ),
            CurrentIMBindingState(
                IMBindingId(f"{prefix}-binding-b"), identity.identity_id, ContactId(f"{prefix}-contact-b")
            ),
        )
        invalid_input = _append_facts(
            base,
            identities=(identity,),
            bindings=bindings,
            reconciled_binding_ids=frozenset(binding.binding_id for binding in bindings),
        )
    else:
        identities = (
            _identity(
                IMIdentityId(f"{prefix}-identity-a"),
                ProviderUserId(f"{prefix}-provider-a"),
                display_name=None,
                email=None,
            ),
            _identity(
                IMIdentityId(f"{prefix}-identity-b"),
                ProviderUserId(f"{prefix}-provider-b"),
                display_name=None,
                email=None,
            ),
        )
        contact_id = ContactId(f"{prefix}-contact")
        bindings = tuple(
            CurrentIMBindingState(IMBindingId(f"{prefix}-binding-{index}"), identity.identity_id, contact_id)
            for index, identity in enumerate(identities)
        )
        invalid_input = _append_facts(
            base,
            identities=identities,
            bindings=bindings,
            reconciled_binding_ids=frozenset(binding.binding_id for binding in bindings),
        )
    return _InvalidCase(
        invalid_input,
        domain,
        ReconciliationBlockCode.INVALID_RECONCILED_BINDING_SET,
    )


@st.composite
def _existing_binding_cases(draw: st.DrawFn) -> _ExistingBindingCase:
    """Embed a known reconciled binding and manual override in a valid background graph.

    This focused domain exposes non-interference regressions while unrelated facts
    continue to vary around the preserved bindings.
    """
    base = draw(_valid_relationship_graphs()).reconciliation_input
    suffix = draw(st.integers(min_value=0, max_value=10_000))
    prefix = f"preserved-{suffix}"
    email = f"{prefix}@example.com"
    provider_user_id = ProviderUserId(f"{prefix}-provider")
    identity = _identity(
        IMIdentityId(f"{prefix}-identity"),
        provider_user_id,
        display_name="Preserved",
        email=email,
    )
    contact = _contact(ContactId(f"{prefix}-contact"), email)
    binding = CurrentIMBindingState(
        IMBindingId(f"{prefix}-binding"),
        identity.identity_id,
        contact.contact_id,
    )
    override = CurrentIMBindingState(
        IMBindingId(f"{prefix}-override"),
        identity.identity_id,
        ContactId(f"{prefix}-override-contact"),
    )
    entry = _entry(provider_user_id, display_name="Preserved", email=email)
    reconciliation_input = _append_facts(
        base,
        entries=(entry,),
        identities=(identity,),
        bindings=(binding, override),
        reconciled_binding_ids=frozenset({binding.binding_id}),
        contacts=(contact,),
    )
    return _ExistingBindingCase(reconciliation_input, provider_user_id, identity, binding, override, contact)


def _generate_plan(reconciliation_input: ReconciliationInput) -> ReconciliationPlan:
    result = SyncReconciler.generate_plan(reconciliation_input)
    assert isinstance(result, ReconciliationPlan)
    return result


def _provider_for_ref(
    reconciliation_input: ReconciliationInput,
    identity_ref: ExistingIMIdentityRef | NewIMIdentityRef | None,
) -> ProviderUserId | None:
    if identity_ref is None:
        return None
    if isinstance(identity_ref, NewIMIdentityRef):
        return identity_ref.provider_user_id
    identity_by_id = {identity.identity_id: identity for identity in reconciliation_input.current_identities}
    return identity_by_id[identity_ref.identity_id].provider_user_id


def _semantic_result(
    reconciliation_input: ReconciliationInput,
    result: ReconciliationPlan | BlockedReconciliation,
) -> _SemanticResult:
    """Normalize a result to public semantics while discarding collection order.

    Permutation laws need this observable because output ordering is not the contract,
    while mutation, result, warning, and blocker meaning is.
    """
    if isinstance(result, BlockedReconciliation):
        return _SemanticResult(
            plan=None,
            blockers=tuple(
                sorted((block.code.value, block.subject_key or "", block.message) for block in result.blockers)
            ),
        )

    identity_upserts = tuple(
        sorted(
            (
                upsert.kind.value,
                str(upsert.entry.provider_user_id),
                str(upsert.normalized_email or ""),
                "\x1f".join(upsert.changed_fields),
                upsert.operation_key,
            )
            for upsert in result.identity_upserts
        )
    )
    binding_mutations: list[tuple[str, ...]] = []
    for mutation in result.binding_mutations:
        if isinstance(mutation, CreateIMBinding):
            binding_mutations.append(
                (
                    "create",
                    str(_provider_for_ref(reconciliation_input, mutation.identity_ref)),
                    str(mutation.contact_id),
                    mutation.reason.value,
                    mutation.operation_key,
                )
            )
        elif isinstance(mutation, ReplaceIMBinding):
            binding_mutations.append(
                (
                    "replace",
                    str(mutation.before.binding_id),
                    str(_provider_for_ref(reconciliation_input, ExistingIMIdentityRef(mutation.before.identity_id))),
                    str(_provider_for_ref(reconciliation_input, mutation.next_identity_ref)),
                    str(mutation.before.contact_id),
                    mutation.reason.value,
                    mutation.removal_reason.value,
                    mutation.operation_key,
                )
            )
        else:
            binding_mutations.append(
                (
                    "delete",
                    str(mutation.before.binding_id),
                    str(_provider_for_ref(reconciliation_input, ExistingIMIdentityRef(mutation.before.identity_id))),
                    str(mutation.before.contact_id),
                    mutation.reason.value,
                    mutation.removal_reason.value,
                    mutation.operation_key,
                )
            )
    identity_deletions = tuple(
        sorted(
            (
                str(deletion.before.provider_user_id),
                deletion.reason.value,
                deletion.operation_key,
            )
            for deletion in result.identity_deletions
        )
    )
    sync_results = tuple(
        sorted(
            (
                item.result_type.value,
                str(item.provider_user_id or ""),
                str(_provider_for_ref(reconciliation_input, item.identity_ref) or ""),
                str(item.binding_id or ""),
                str(item.contact_id or ""),
                item.reason_code or "",
                item.operation_key,
            )
            for item in result.sync_results
        )
    )
    warnings = tuple(
        sorted(
            (
                warning.reason.value,
                "\x1f".join(sorted(str(_provider_for_ref(reconciliation_input, ref)) for ref in warning.identity_refs)),
                "\x1f".join(sorted(str(contact_id) for contact_id in warning.contact_ids)),
                warning.warning_key,
            )
            for warning in result.warnings
        )
    )
    return _SemanticResult(
        plan=_SemanticPlan(
            identity_upserts=identity_upserts,
            binding_mutations=tuple(sorted(binding_mutations)),
            identity_deletions=identity_deletions,
            sync_results=sync_results,
            warnings=warnings,
        ),
        blockers=(),
    )


def _resolve_identity_id(identity_ref: ExistingIMIdentityRef | NewIMIdentityRef) -> IMIdentityId:
    if isinstance(identity_ref, ExistingIMIdentityRef):
        return identity_ref.identity_id
    return IMIdentityId(f"projected-identity:{identity_ref.provider_user_id}")


def _project_plan(reconciliation_input: ReconciliationInput, plan: ReconciliationPlan) -> _ProjectedState:
    """Interpret typed plan mutations as the persisted state visible to the next run.

    This policy-free projector enables closure and convergence laws without duplicating
    the reconciler's matching decisions in the test oracle.
    """
    identities = {identity.identity_id: identity for identity in reconciliation_input.current_identities}
    for upsert in plan.identity_upserts:
        identity_id = _resolve_identity_id(upsert.identity_ref)
        identities[identity_id] = CurrentIMIdentityState(
            identity_id=identity_id,
            provider_user_id=upsert.entry.provider_user_id,
            display_name=upsert.entry.display_name,
            email=upsert.entry.email,
            normalized_email=upsert.normalized_email,
            last_seen_sync_run_id=plan.run.sync_run_id,
        )

    bindings = {binding.binding_id: binding for binding in reconciliation_input.current_bindings}
    reconciled_binding_ids = set(reconciliation_input.reconciled_binding_ids)
    for mutation in plan.binding_mutations:
        if isinstance(mutation, CreateIMBinding):
            provider_user_id = _provider_for_ref(reconciliation_input, mutation.identity_ref)
            assert provider_user_id is not None
            binding_id = IMBindingId(f"projected-binding:{provider_user_id}:{mutation.contact_id}")
            bindings[binding_id] = CurrentIMBindingState(
                binding_id=binding_id,
                identity_id=_resolve_identity_id(mutation.identity_ref),
                contact_id=mutation.contact_id,
            )
            reconciled_binding_ids.add(binding_id)
        elif isinstance(mutation, ReplaceIMBinding):
            was_reconciled = mutation.before.binding_id in reconciled_binding_ids
            bindings.pop(mutation.before.binding_id)
            reconciled_binding_ids.discard(mutation.before.binding_id)
            provider_user_id = _provider_for_ref(reconciliation_input, mutation.next_identity_ref)
            assert provider_user_id is not None
            binding_id = IMBindingId(f"projected-replacement:{mutation.before.binding_id}:{provider_user_id}")
            bindings[binding_id] = CurrentIMBindingState(
                binding_id=binding_id,
                identity_id=_resolve_identity_id(mutation.next_identity_ref),
                contact_id=mutation.before.contact_id,
            )
            if was_reconciled:
                reconciled_binding_ids.add(binding_id)
        else:
            bindings.pop(mutation.before.binding_id)
            reconciled_binding_ids.discard(mutation.before.binding_id)

    for deletion in plan.identity_deletions:
        identities.pop(deletion.before.identity_id)

    return _ProjectedState(
        identities=tuple(sorted(identities.values(), key=lambda identity: str(identity.identity_id))),
        bindings=tuple(sorted(bindings.values(), key=lambda binding: str(binding.binding_id))),
        reconciled_binding_ids=frozenset(reconciled_binding_ids),
    )


def _next_input(reconciliation_input: ReconciliationInput, projected: _ProjectedState) -> ReconciliationInput:
    next_run = ReconciliationRunRef(
        sync_run_id=IMSyncRunId(f"{reconciliation_input.run.sync_run_id}:next"),
        integration_revision=reconciliation_input.run.integration_revision,
        provider=reconciliation_input.run.provider,
    )
    return ReconciliationInput(
        run=next_run,
        directory_entries=reconciliation_input.directory_entries,
        current_identities=projected.identities,
        current_bindings=projected.bindings,
        reconciled_binding_ids=projected.reconciled_binding_ids,
        contacts_for_email_matching=reconciliation_input.contacts_for_email_matching,
    )


def _binding_mutation_before_id(
    mutation: CreateIMBinding | ReplaceIMBinding | DeleteIMBinding,
) -> IMBindingId | None:
    if isinstance(mutation, CreateIMBinding):
        return None
    return mutation.before.binding_id


def _results_for_directory_provider(
    plan: ReconciliationPlan,
    provider_user_id: ProviderUserId,
) -> tuple[PlannedSyncResult, ...]:
    return tuple(item for item in plan.sync_results if item.provider_user_id == provider_user_id)


def _reversed_fact_inputs(reconciliation_input: ReconciliationInput) -> tuple[ReconciliationInput, ...]:
    return (
        replace(
            reconciliation_input,
            directory_entries=tuple(reversed(reconciliation_input.directory_entries)),
        ),
        replace(
            reconciliation_input,
            current_identities=tuple(reversed(reconciliation_input.current_identities)),
        ),
        replace(
            reconciliation_input,
            current_bindings=tuple(reversed(reconciliation_input.current_bindings)),
        ),
        replace(
            reconciliation_input,
            contacts_for_email_matching=tuple(reversed(reconciliation_input.contacts_for_email_matching)),
        ),
    )


@settings(max_examples=100, deadline=None)
@given(case=_plan_cases())
@example(case=_canonical_empty_case())
@example(case=_canonical_unique_match_case())
@example(case=_canonical_duplicate_contact_recovery_case())
def test_p01_valid_plan_closure_and_conservation(case: _GeneratedCase) -> None:
    """Valid and recoverable graphs produce closed plans that conserve directory facts.

    The law covers reference validity, complete removal of absent identities, and a
    projected state with valid one-to-one reconciled bindings. It exists because those
    relationships form a combinatorial state space that decision-table examples cannot
    exhaust.
    """
    reconciliation_input = case.reconciliation_input
    plan = _generate_plan(reconciliation_input)
    directory_provider_ids = {entry.provider_user_id for entry in reconciliation_input.directory_entries}
    current_provider_ids = {identity.provider_user_id for identity in reconciliation_input.current_identities}

    assert Counter(upsert.entry.provider_user_id for upsert in plan.identity_upserts) == Counter(
        entry.provider_user_id for entry in reconciliation_input.directory_entries
    )
    assert {deletion.before.provider_user_id for deletion in plan.identity_deletions} == (
        current_provider_ids - directory_provider_ids
    )

    current_identity_ids = {identity.identity_id for identity in reconciliation_input.current_identities}
    new_provider_ids = {
        upsert.identity_ref.provider_user_id
        for upsert in plan.identity_upserts
        if isinstance(upsert.identity_ref, NewIMIdentityRef)
    }
    refs = [upsert.identity_ref for upsert in plan.identity_upserts]
    refs.extend(
        mutation.identity_ref if isinstance(mutation, CreateIMBinding) else mutation.next_identity_ref
        for mutation in plan.binding_mutations
        if isinstance(mutation, (CreateIMBinding, ReplaceIMBinding))
    )
    refs.extend(item.identity_ref for item in plan.sync_results if item.identity_ref is not None)
    refs.extend(ref for warning in plan.warnings for ref in warning.identity_refs)
    assert all(
        (isinstance(ref, ExistingIMIdentityRef) and ref.identity_id in current_identity_ids)
        or (isinstance(ref, NewIMIdentityRef) and ref.provider_user_id in new_provider_ids)
        for ref in refs
    )

    identity_by_id = {identity.identity_id: identity for identity in reconciliation_input.current_identities}
    absent_identity_ids = {
        identity.identity_id
        for identity in reconciliation_input.current_identities
        if identity.provider_user_id not in directory_provider_ids
    }
    targeted_binding_counts = Counter(
        binding_id
        for mutation in plan.binding_mutations
        if (binding_id := _binding_mutation_before_id(mutation)) is not None
    )
    for binding in reconciliation_input.current_bindings:
        if binding.identity_id in absent_identity_ids:
            assert targeted_binding_counts[binding.binding_id] == 1
        else:
            assert identity_by_id[binding.identity_id].provider_user_id in current_provider_ids

    projected = _project_plan(reconciliation_input, plan)
    projected_identity_ids = {identity.identity_id for identity in projected.identities}
    assert all(binding.identity_id in projected_identity_ids for binding in projected.bindings)
    projected_binding_by_id = {binding.binding_id: binding for binding in projected.bindings}
    projected_reconciled = [projected_binding_by_id[binding_id] for binding_id in projected.reconciled_binding_ids]
    assert max(Counter(binding.identity_id for binding in projected_reconciled).values(), default=0) <= 1
    assert max(Counter(binding.contact_id for binding in projected_reconciled).values(), default=0) <= 1
    assert {identity.provider_user_id for identity in projected.identities} == directory_provider_ids


@settings(max_examples=100, deadline=None)
@given(case=_plan_cases())
@example(case=_canonical_replacement_case())
def test_p02_determinism_and_input_permutation_invariance(case: _GeneratedCase) -> None:
    """Repeated planning and fact permutations preserve the same semantic plan.

    The law prevents hidden collection-order dependencies, which are easy to miss with
    fixed examples and would make equivalent persisted states reconcile differently.
    """
    reconciliation_input = case.reconciliation_input
    first = SyncReconciler.generate_plan(reconciliation_input)
    assert SyncReconciler.generate_plan(reconciliation_input) == first

    first_semantics = _semantic_result(reconciliation_input, first)
    for permuted_input in _reversed_fact_inputs(reconciliation_input):
        permuted_result = SyncReconciler.generate_plan(permuted_input)
        assert _semantic_result(permuted_input, permuted_result) == first_semantics


@settings(max_examples=100, deadline=None)
@given(case=_single_violation_cases())
@example(case=_canonical_duplicate_provider_case())
def test_p02_blocker_semantics_are_permutation_invariant(case: _InvalidCase) -> None:
    """Permuting an invalid graph preserves its blocker semantics.

    Structural corruption must be classified from relationships rather than input
    order; generated violations guard that invariant beyond a canonical blocker case.
    """
    reconciliation_input = case.reconciliation_input
    first = SyncReconciler.generate_plan(reconciliation_input)
    first_semantics = _semantic_result(reconciliation_input, first)

    for permuted_input in _reversed_fact_inputs(reconciliation_input):
        permuted_result = SyncReconciler.generate_plan(permuted_input)
        assert _semantic_result(permuted_input, permuted_result) == first_semantics


@settings(max_examples=100, deadline=None)
@given(case=_plan_cases())
@example(case=_canonical_replacement_case())
def test_p03_projected_plan_converges_on_the_second_run(case: _GeneratedCase) -> None:
    """Applying a plan reaches a fixed point for binding and deletion decisions.

    A second run may refresh present identities but must not repeat structural writes or
    change stable outcomes. This projection law protects recurring syncs from mutation
    churn that isolated first-run examples cannot reveal.
    """
    first_input = case.reconciliation_input
    first_plan = _generate_plan(first_input)
    second_input = _next_input(first_input, _project_plan(first_input, first_plan))
    second_plan = _generate_plan(second_input)

    assert second_plan.binding_mutations == ()
    assert second_plan.identity_deletions == ()
    assert {upsert.kind for upsert in second_plan.identity_upserts} <= {IMIdentityUpsertKind.REFRESH}
    assert len(second_plan.identity_upserts) == len(first_input.directory_entries)

    for entry in first_input.directory_entries:
        first_results = _results_for_directory_provider(first_plan, entry.provider_user_id)
        second_results = _results_for_directory_provider(second_plan, entry.provider_user_id)
        assert len(first_results) == 1
        assert len(second_results) == 1
        first_result = first_results[0]
        second_result = second_results[0]
        if first_result.result_type is IMSyncResultType.NOT_MATCHED:
            assert (second_result.result_type, second_result.reason_code) == (
                IMSyncResultType.NOT_MATCHED,
                first_result.reason_code,
            )
        else:
            assert second_result.result_type is IMSyncResultType.SKIPPED


@settings(max_examples=100, deadline=None)
@given(case=_existing_binding_cases())
@example(case=_canonical_existing_binding_case())
def test_p04_existing_binding_and_override_non_interference(case: _ExistingBindingCase) -> None:
    """Existing reconciled bindings and manual overrides change only when their owner disappears.

    Profile changes, missing match candidates, and unrelated facts must not disturb
    those bindings. This law generalizes preservation across background graphs where a
    small set of examples could hide cross-record interference.
    """
    baseline_plan = _generate_plan(case.reconciliation_input)
    target_mutation_ids = {
        binding_id
        for mutation in baseline_plan.binding_mutations
        if (binding_id := _binding_mutation_before_id(mutation)) is not None
    }
    assert case.binding.binding_id not in target_mutation_ids
    assert case.override.binding_id not in target_mutation_ids
    assert (
        _results_for_directory_provider(baseline_plan, case.provider_user_id)[0].result_type is IMSyncResultType.SKIPPED
    )

    override_only_provider_user_id = ProviderUserId(f"override-only-{case.provider_user_id}")
    override_only_email = f"override-only-{case.provider_user_id}@example.com"
    override_only_identity = _identity(
        IMIdentityId(f"override-only-{case.identity.identity_id}"),
        override_only_provider_user_id,
        display_name="Override only",
        email=override_only_email,
    )
    override_only_contact = _contact(
        ContactId(f"override-only-{case.contact.contact_id}"),
        override_only_email,
    )
    override_only_binding = CurrentIMBindingState(
        binding_id=IMBindingId(f"override-only-{case.override.binding_id}"),
        identity_id=override_only_identity.identity_id,
        contact_id=override_only_contact.contact_id,
    )
    override_only_input = _append_facts(
        case.reconciliation_input,
        entries=(
            _entry(
                override_only_provider_user_id,
                display_name="Override only",
                email=override_only_email,
            ),
        ),
        identities=(override_only_identity,),
        bindings=(override_only_binding,),
        contacts=(override_only_contact,),
    )
    override_only_plan = _generate_plan(override_only_input)
    assert any(
        isinstance(mutation, CreateIMBinding)
        and _provider_for_ref(override_only_input, mutation.identity_ref) == override_only_provider_user_id
        and mutation.contact_id == override_only_contact.contact_id
        for mutation in override_only_plan.binding_mutations
    )
    assert override_only_binding.binding_id not in {
        binding_id
        for mutation in override_only_plan.binding_mutations
        if (binding_id := _binding_mutation_before_id(mutation)) is not None
    }

    changed_entry = _entry(
        case.provider_user_id,
        display_name="Changed profile",
        email=f"changed-{case.provider_user_id}@example.com",
    )
    unrelated_entry = _entry(
        ProviderUserId(f"unrelated-{case.provider_user_id}"),
        display_name=None,
        email=None,
    )
    transformed_input = replace(
        case.reconciliation_input,
        directory_entries=tuple(
            entry
            for entry in case.reconciliation_input.directory_entries
            if entry.provider_user_id != case.provider_user_id
        )
        + (changed_entry, unrelated_entry),
        contacts_for_email_matching=tuple(
            contact
            for contact in case.reconciliation_input.contacts_for_email_matching
            if contact.contact_id != case.contact.contact_id
        ),
    )
    transformed_plan = _generate_plan(transformed_input)
    transformed_target_ids = {
        binding_id
        for mutation in transformed_plan.binding_mutations
        if (binding_id := _binding_mutation_before_id(mutation)) is not None
    }
    assert case.binding.binding_id not in transformed_target_ids
    assert case.override.binding_id not in transformed_target_ids
    transformed_result = _results_for_directory_provider(transformed_plan, case.provider_user_id)[0]
    assert (transformed_result.result_type, transformed_result.contact_id) == (
        IMSyncResultType.SKIPPED,
        case.binding.contact_id,
    )

    absent_input = replace(
        case.reconciliation_input,
        directory_entries=tuple(
            entry
            for entry in case.reconciliation_input.directory_entries
            if entry.provider_user_id != case.provider_user_id
        ),
    )
    absent_plan = _generate_plan(absent_input)
    absent_target_counts = Counter(
        binding_id
        for mutation in absent_plan.binding_mutations
        if (binding_id := _binding_mutation_before_id(mutation)) is not None
    )
    assert absent_target_counts[case.binding.binding_id] == 1
    assert absent_target_counts[case.override.binding_id] == 1
    assert case.identity.identity_id in {deletion.before.identity_id for deletion in absent_plan.identity_deletions}


@settings(max_examples=100, deadline=None)
@given(case=_plan_cases())
@example(case=_canonical_unique_match_case())
@example(case=_canonical_replacement_case())
def test_p05_binding_mutations_satisfy_independent_safety_conditions(case: _GeneratedCase) -> None:
    """Every create or replacement independently proves all email-match safety conditions.

    The target contact and provider must be uniquely admissible, email-equivalent, and
    free of conflicting reconciled ownership. Checking every generated mutation avoids
    an expected-output example masking an unsafe mutation elsewhere in the same plan.
    """
    reconciliation_input = case.reconciliation_input
    plan = _generate_plan(reconciliation_input)
    contact_email_counts = Counter(
        contact.normalized_email for contact in reconciliation_input.contacts_for_email_matching
    )
    contacts_by_id = {contact.contact_id: contact for contact in reconciliation_input.contacts_for_email_matching}
    normalized_email_by_provider = {
        upsert.entry.provider_user_id: upsert.normalized_email for upsert in plan.identity_upserts
    }
    current_identity_by_id = {identity.identity_id: identity for identity in reconciliation_input.current_identities}
    reconciled_bindings = tuple(
        binding
        for binding in reconciliation_input.current_bindings
        if binding.binding_id in reconciliation_input.reconciled_binding_ids
    )
    reconciled_binding_by_identity = {binding.identity_id: binding for binding in reconciled_bindings}
    reconciled_binding_by_contact = {binding.contact_id: binding for binding in reconciled_bindings}
    directory_provider_ids = {entry.provider_user_id for entry in reconciliation_input.directory_entries}
    unbound_providers_by_email: dict[NormalizedEmail, list[ProviderUserId]] = defaultdict(list)
    for entry in reconciliation_input.directory_entries:
        current_identity = next(
            (
                identity
                for identity in reconciliation_input.current_identities
                if identity.provider_user_id == entry.provider_user_id
            ),
            None,
        )
        has_reconciled_binding = (
            current_identity is not None and current_identity.identity_id in reconciled_binding_by_identity
        )
        normalized_email = normalized_email_by_provider[entry.provider_user_id]
        if not has_reconciled_binding and normalized_email is not None:
            unbound_providers_by_email[normalized_email].append(entry.provider_user_id)

    for mutation in plan.binding_mutations:
        if isinstance(mutation, DeleteIMBinding):
            continue
        contact = mutation.contact_precondition
        assert contacts_by_id[contact.contact_id] == contact
        assert contact_email_counts[contact.normalized_email] == 1
        target_ref = mutation.identity_ref if isinstance(mutation, CreateIMBinding) else mutation.next_identity_ref
        target_provider_user_id = _provider_for_ref(reconciliation_input, target_ref)
        assert target_provider_user_id is not None
        assert normalized_email_by_provider[target_provider_user_id] == contact.normalized_email
        assert unbound_providers_by_email[contact.normalized_email] == [target_provider_user_id]
        if isinstance(target_ref, ExistingIMIdentityRef):
            assert target_ref.identity_id not in reconciled_binding_by_identity

        occupying_binding = reconciled_binding_by_contact.get(contact.contact_id)
        if isinstance(mutation, CreateIMBinding):
            assert occupying_binding is None
        else:
            assert occupying_binding == mutation.before
            old_provider_user_id = current_identity_by_id[mutation.before.identity_id].provider_user_id
            assert old_provider_user_id not in directory_provider_ids
            assert target_provider_user_id in directory_provider_ids


def _matching_results(
    plan: ReconciliationPlan,
    *,
    result_type: IMSyncResultType,
    provider_user_id: ProviderUserId,
    binding_id: IMBindingId | None,
    contact_id: ContactId,
) -> tuple[PlannedSyncResult, ...]:
    return tuple(
        item
        for item in plan.sync_results
        if item.result_type is result_type
        and item.provider_user_id == provider_user_id
        and item.binding_id == binding_id
        and item.contact_id == contact_id
    )


@settings(max_examples=100, deadline=None)
@given(case=_plan_cases())
@example(case=_canonical_replacement_case())
def test_p06_result_and_operation_key_consistency(case: _GeneratedCase) -> None:
    """Plan results faithfully describe mutations and all operation keys remain unique and stable.

    This correspondence is the observable contract for execution and audit records.
    Generated mixed-operation plans protect it from drift that single-operation examples
    would not expose.
    """
    reconciliation_input = case.reconciliation_input
    plan = _generate_plan(reconciliation_input)
    current_identity_by_id = {identity.identity_id: identity for identity in reconciliation_input.current_identities}
    for mutation in plan.binding_mutations:
        if isinstance(mutation, CreateIMBinding):
            provider_user_id = _provider_for_ref(reconciliation_input, mutation.identity_ref)
            assert provider_user_id is not None
            assert (
                len(
                    _matching_results(
                        plan,
                        result_type=IMSyncResultType.ADDED,
                        provider_user_id=provider_user_id,
                        binding_id=None,
                        contact_id=mutation.contact_id,
                    )
                )
                == 1
            )
        elif isinstance(mutation, DeleteIMBinding):
            provider_user_id = current_identity_by_id[mutation.before.identity_id].provider_user_id
            assert (
                len(
                    _matching_results(
                        plan,
                        result_type=IMSyncResultType.REMOVED,
                        provider_user_id=provider_user_id,
                        binding_id=mutation.before.binding_id,
                        contact_id=mutation.before.contact_id,
                    )
                )
                == 1
            )
        else:
            previous_provider_user_id = current_identity_by_id[mutation.before.identity_id].provider_user_id
            next_provider_user_id = _provider_for_ref(reconciliation_input, mutation.next_identity_ref)
            assert next_provider_user_id is not None
            assert (
                len(
                    _matching_results(
                        plan,
                        result_type=IMSyncResultType.REMOVED,
                        provider_user_id=previous_provider_user_id,
                        binding_id=mutation.before.binding_id,
                        contact_id=mutation.before.contact_id,
                    )
                )
                == 1
            )
            assert (
                len(
                    _matching_results(
                        plan,
                        result_type=IMSyncResultType.ADDED,
                        provider_user_id=next_provider_user_id,
                        binding_id=None,
                        contact_id=mutation.before.contact_id,
                    )
                )
                == 1
            )

    current_binding_identity_ids = {binding.identity_id for binding in reconciliation_input.current_bindings}
    for deletion in plan.identity_deletions:
        if deletion.before.identity_id not in current_binding_identity_ids:
            assert not any(
                item.result_type is IMSyncResultType.REMOVED
                and item.provider_user_id == deletion.before.provider_user_id
                for item in plan.sync_results
            )

    directory_provider_ids = {entry.provider_user_id for entry in reconciliation_input.directory_entries}
    for binding in reconciliation_input.current_bindings:
        if binding.binding_id not in reconciliation_input.reconciled_binding_ids:
            continue
        provider_user_id = current_identity_by_id[binding.identity_id].provider_user_id
        if provider_user_id in directory_provider_ids:
            assert (
                len(
                    _matching_results(
                        plan,
                        result_type=IMSyncResultType.SKIPPED,
                        provider_user_id=provider_user_id,
                        binding_id=binding.binding_id,
                        contact_id=binding.contact_id,
                    )
                )
                == 1
            )

    mutation_keys = (
        *(upsert.operation_key for upsert in plan.identity_upserts),
        *(mutation.operation_key for mutation in plan.binding_mutations),
        *(deletion.operation_key for deletion in plan.identity_deletions),
    )
    result_keys = tuple(item.operation_key for item in plan.sync_results)
    assert len(mutation_keys) == len(set(mutation_keys))
    assert len(result_keys) == len(set(result_keys))

    reversed_input = replace(
        reconciliation_input,
        directory_entries=tuple(reversed(reconciliation_input.directory_entries)),
        current_identities=tuple(reversed(reconciliation_input.current_identities)),
        current_bindings=tuple(reversed(reconciliation_input.current_bindings)),
        contacts_for_email_matching=tuple(reversed(reconciliation_input.contacts_for_email_matching)),
    )
    reversed_plan = _generate_plan(reversed_input)
    assert _semantic_result(reversed_input, reversed_plan) == _semantic_result(reconciliation_input, plan)


@settings(max_examples=100, deadline=None)
@given(case=_single_violation_cases())
@example(case=_canonical_duplicate_provider_case())
def test_p07_single_violation_blocker_soundness_and_completeness(case: _InvalidCase) -> None:
    """Each isolated structural violation blocks with exactly its corresponding code.

    The law establishes both blocker soundness and completeness across variants of each
    invalid domain, rather than trusting one representative corruption example.
    """
    result = SyncReconciler.generate_plan(case.reconciliation_input)

    assert isinstance(result, BlockedReconciliation)
    assert {block.code for block in result.blockers} == {case.expected_code}
    assert result.run == case.reconciliation_input.run


@settings(max_examples=100, deadline=None)
@given(case=_business_or_recovery_cases())
@example(case=_canonical_missing_email_case())
@example(case=_canonical_duplicate_contact_recovery_case())
def test_p07_business_ambiguity_and_contact_recovery_do_not_block(case: _GeneratedCase) -> None:
    """Business ambiguity and recoverable contact collisions still produce a plan.

    This negative-boundary law prevents conservative per-entry outcomes from being
    promoted to run-level blockers as surrounding graph relationships vary.
    """
    assert isinstance(SyncReconciler.generate_plan(case.reconciliation_input), ReconciliationPlan)

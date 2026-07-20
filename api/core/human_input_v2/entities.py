from typing import NewType

# Identifiers for organization candidates and contacts.
OrganizationCandidateId = NewType("OrganizationCandidateId", str)

# Identifiers for contacts.
ContactId = NewType("ContactId", str)

# Identifiers for synced IM identiies. This is not the same as user_id or account_id
# on the IM provier side. It is the identifier for the synced IM user record in Dify.
IMIdentityId = NewType("IMIdentityId", str)

# Identifiers for a full IM user synchorization.
IMSyncRunId = NewType("IMSyncRunId", str)

# Identifier for an IM binding, an association between an IM identity and a Dify contact.
IMBindingId = NewType("IMBindingId", str)

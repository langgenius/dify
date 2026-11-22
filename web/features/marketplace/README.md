# Marketplace

Marketplace owns deployment availability, navigation and asset addresses, and
shared generated queries. Console consumers use the capability-gated client so
disabling Marketplace disables its links and requests together.

Search results retain the generated Marketplace response shape. Plugin cards and
installation surfaces own their presentation conversion; the shared capability
must not depend on their UI types or utilities.

The existing Marketplace import rule protects availability-sensitive Console
access. Marketplace's own UI and service transport retain their scoped exceptions.

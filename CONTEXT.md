# Dify Cloud Billing

This context describes billing concepts used by Dify Cloud subscription and invoice-based payment flows.

## Language

**Active Invoice Flow**:
A workspace-level invoice payment flow that blocks new card checkout or invoice requests until the flow is paid, expired, or canceled.
_Avoid_: Active Invoice, single invoice lock, payment request lock

**Workspace**:
The tenant whose subscription, invoices, and billing locks are being managed.
_Avoid_: Account, customer account

**Plan Activation**:
The moment a workspace receives paid-plan entitlement after Dify confirms the subscription is active.
_Avoid_: Payment detected, payment received

## Relationships

- A **Workspace** has at most one **Active Invoice Flow**.
- An **Active Invoice Flow** may include one or more Stripe invoices across first payment and renewal.
- An unresolved **Active Invoice Flow** blocks both card checkout and additional invoice requests for the **Workspace**.
- **Plan Activation** occurs only after Dify confirms the subscription is active, not when payment is merely detected or under reconciliation.

## Example dialogue

> **Dev:** "If the renewal invoice is unpaid, can the workspace start a new card checkout?"
> **Domain expert:** "No. The Workspace still has an Active Invoice Flow, so both card checkout and new invoice requests remain blocked until it is paid, expired, or canceled."

> **Dev:** "Stripe says payment is being confirmed. Should we enable the Team plan now?"
> **Domain expert:** "No. Plan Activation waits until Dify confirms the subscription is active."

## Flagged ambiguities

- "active Invoice" was used to mean both a single Stripe invoice and the broader workspace billing lock. Resolved: use **Active Invoice Flow** for the workspace-level lock.

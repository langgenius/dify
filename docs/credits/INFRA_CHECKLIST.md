# Nexoraa Credits Platform — Infrastructure Confirmation Checklist

**Owner:** Narayana Chavva
**Required by:** Start of Week 1 (May 20, 2026)
**Purpose:** Confirm all AWS infrastructure names and settings before ENG-4 migrations are written. Migration scripts, EventBridge rules, and S3 export paths are all hardcoded to these values.

---

## How to Use This Checklist

Fill in each `[ ]` item. Once all items are confirmed, commit the updated file and close ENG-1. Any item left blank blocks Week 1 implementation for the relevant ticket.

---

## AWS Account & Region

| Item | Value | Confirmed by | Date |
|---|---|---|---|
| AWS Account ID | *(fill in)* | | |
| Primary region | `ap-south-1` (Mumbai) | Based on ECR config in `.github/workflows/` | ✅ |
| Staging environment account | *(fill in — same account, separate namespace, or separate account?)* | | |

---

## Aurora PostgreSQL (Primary Database)

| Item | Value | Confirmed by | Date |
|---|---|---|---|
| Cluster identifier | *(fill in — e.g., `nexoraa-credits-prod`)* | | |
| Instance class (writer) | *(fill in — e.g., `db.r6g.xlarge`)* | | |
| Instance class (reader) | *(fill in)* | | |
| PostgreSQL engine version | *(fill in — minimum 14.x for UUID v7 support via `pgcrypto`)* | | |
| Parameter group | *(fill in)* | | |
| Subnet group | *(fill in)* | | |
| Staging cluster identifier | *(fill in)* | | |
| Max connections (writer) | *(fill in — needed for connection pool sizing)* | | |

**Note:** ENG-4 migrations run against this cluster. The `app.current_tenant_id` session variable (used for RLS) requires PostgreSQL 14+ and the `set_config()` function.

---

## EventBridge

| Bus Name | Purpose | Confirmed by | Date |
|---|---|---|---|
| *(fill in — e.g., `nexoraa-credits-prod`)* | Primary Credits Platform event bus | | |
| *(fill in — e.g., `nexoraa-credits-staging`)* | Staging event bus | | |

**Events emitted on this bus (ENG-6, ENG-15, ENG-17, ENG-19):**
- `workflow.started`
- `workflow.completed`
- `workflow.failed`
- `workflow.rated`
- `approval.requested`
- `approval.decided`
- `approval.timed_out`
- `reaper.released`
- `tenant.updated`
- `entitlement.override.changed`

---

## SQS Dead-Letter Queues

| Queue Name | Purpose | Retention | Confirmed by | Date |
|---|---|---|---|---|
| *(fill in — e.g., `nexoraa-credits-events-dlq`)* | Failed/invalid usage events (ENG-11) | 14 days | | |
| *(fill in — e.g., `nexoraa-credits-rating-dlq`)* | Failed settlement jobs (ENG-15) | 14 days | | |

**CloudWatch alarm:** DLQ depth > 0 triggers P1 alert. Alarm ARN: *(fill in)*

---

## S3 Buckets

| Bucket Name | Purpose | Object Lock | Confirmed by | Date |
|---|---|---|---|---|
| *(fill in — e.g., `nexoraa-billing-prod`)* | Invoice CSV/PDF exports, vendor invoices, reconciliation reports | No | | |
| *(fill in — e.g., `nexoraa-audit-prod`)* | Immutable audit log archive (SOC 2 — ENG-35) | **COMPLIANCE mode, 7-year retention** | | |

**S3 key naming conventions (fill in or confirm defaults):**

```
invoices/{year}/{month}/{tenant_id}/invoice_{tenant_id}_{period}.csv
invoices/{year}/{month}/{tenant_id}/invoice_{tenant_id}_{period}.pdf
vendor-invoices/{vendor}/{year}/{month}/
reconciliation-reports/{year}/{month}/
```

---

## AWS Secrets Manager

| Secret Name | Contents | Confirmed by | Date |
|---|---|---|---|
| *(fill in — e.g., `nexoraa/credits/prod/db`)* | Aurora connection string | | |
| *(fill in — e.g., `nexoraa/credits/prod/stripe`)* | Stripe API key + webhook secret | | |
| *(fill in — e.g., `nexoraa/credits/prod/mtls-ca`)* | Private CA ARN for mTLS (ENG-36) | | |

**Rule:** No secrets in `.env` files committed to the repo. All secrets fetched from Secrets Manager at service startup.

---

## AWS Private CA (for mTLS — ENG-36)

| Item | Value | Confirmed by | Date |
|---|---|---|---|
| Private CA ARN | *(fill in)* | | |
| Certificate TTL | 1 hour (per ADR; ENG-36 spec) | | |
| Renewal window | 15 minutes before expiry (per ENG-36 spec) | | |

---

## CloudWatch

| Alarm | Threshold | SNS Topic ARN | Confirmed by | Date |
|---|---|---|---|---|
| DLQ depth > 0 (any queue) | depth > 0 | *(fill in)* | | |
| Reconciliation discrepancy | count > 0 | *(fill in)* | | |
| Reaper releases | > 100/day | *(fill in)* | | |
| Rating settlement p99 | > 30 seconds | *(fill in)* | | |
| Wallet optimistic-lock conflict rate | > 1% | *(fill in)* | | |
| Margin warning count per tenant | > 5/day | *(fill in)* | | |
| Tenant stuck in `observe_only` | age > 14 days | *(fill in)* | | |

---

## Confirmation Sign-off

When all items above are confirmed, add sign-offs here:

| Role | Name | Date |
|---|---|---|
| Engineering Lead | | |
| Infrastructure / DevOps | | |
| Finance (for billing bucket naming) | | |

Once signed off, this file is locked. Changes require a new PR with Engineering Lead approval.

---

*Nexoraa Credits Platform — Infrastructure Confirmation Checklist*
*ENG-1 pre-work. Must be complete before Week 1 migrations (ENG-4) are merged.*

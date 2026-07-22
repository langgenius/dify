# knowledge-fs on AWS — Terraform

Infrastructure-as-code for running the **Standalone** deployment target of `knowledge-fs`
on AWS. This directory currently holds **only the target architecture diagram**.
The Terraform code and deployment runbook are intentionally **not written yet** — see
[Status](#status).

## Target architecture

```
                 ┌──────────────────────────── VPC ────────────────────────────┐
                 │                                                              │
  client ──TLS──▶│  ┌──────────────── EC2 ───────────────┐    ┌──────────────┐  │
  (HTTP / MCP)   │  │  api  (:8787, compiled JS, non-root)│    │  Aurora      │  │
                 │  │   ├─ retrieval / ingestion          │TCP │  Serverless  │  │
                 │  │   ├─ pg-boss jobs ──────────────────┼───▶│  v2          │  │
                 │  │   └─ in-process cache (single node) │5432│  PostgreSQL  │  │
                 │  │  unstructured  (:8000, doc parsing) │    │  + pgvector  │  │
                 │  └──────────────────┬──────────────────┘    └──────────────┘  │
                 │                     │ HTTPS (S3 API)                          │
                 │                     │ creds via EC2 IAM instance role        │
                 └─────────────────────┼─────────────────────────────────────────┘
                                       ▼
                                 ┌───────────┐
                                 │  AWS S3   │   bucket: knowledge-fs
                                 └───────────┘
```

## Component mapping

| knowledge-fs component        | AWS service                          | Notes |
|-------------------------------|--------------------------------------|-------|
| API gateway (`apps/api`)      | EC2 (Docker container)               | `compose.middleware.yaml` minus DB/MinIO; runs compiled JS as non-root |
| Document parsing (unstructured)| EC2 (same instance, Docker)         | ML image — size the box for it; can split to its own instance later |
| PostgreSQL + pgvector         | **Aurora Serverless v2 (PostgreSQL)**| Standard TCP endpoint (not the Data API); `CREATE EXTENSION vector` |
| Job queue (pg-boss)           | Same Aurora cluster                  | Postgres-backed; no extra service |
| Object storage                | **AWS S3**                           | `MINIO_*` env points at S3; credentials via **IAM instance role** |
| Cache                         | In-process (single EC2)              | No ElastiCache today — see [Open decisions](#open-decisions) |
| Admin console (`apps/admin`)  | _not deployed in this topology_      | Optional Next.js UI; add as a second container if a web console is needed |

## Environment wiring

```bash
# Aurora Serverless v2 — standard cluster endpoint, TCP
DATABASE_URL=postgresql://<user>:<pass>@<cluster-endpoint>:5432/knowledge_fs

# S3 via the S3-compatible object-storage path. NO MINIO_ACCESS_KEY / MINIO_SECRET_KEY:
# the EC2 IAM instance role supplies credentials through the AWS SDK default chain.
MINIO_ENDPOINT=https://s3.<region>.amazonaws.com
MINIO_REGION=<region>
MINIO_BUCKET=knowledge-fs

# Unstructured runs locally on the same EC2 host
UNSTRUCTURED_API_URL=http://127.0.0.1:8000
```

## EC2 metadata requirement for S3 IAM role

The API container relies on the AWS SDK default credential chain to read the EC2
instance role. Because the API runs inside Docker, the EC2 instance metadata
service must allow the IMDSv2 token response to cross the container network hop.
The Terraform EC2 resource/runbook must set:

```hcl
metadata_options {
  http_endpoint               = "enabled"
  http_tokens                 = "required"
  http_put_response_hop_limit = 2
}
```

Without the hop limit of `2`, a containerized API can have a valid instance role
but still fail to obtain S3 credentials from IMDSv2.

## Open decisions

These are deliberately deferred until the Terraform code is written:

1. **Single EC2 = no HA / single point of failure.** Fine to start. Scaling the API to
   multiple instances later requires a **shared cache (ElastiCache)** because the cache is
   in-process today, and cache keys carry tenant + permission scope.
2. **Aurora SSL.** If the cluster parameter group sets `rds.force_ssl`, either use
   `?sslmode=no-verify` or front the cluster with **RDS Proxy** (which also smooths
   Serverless v2 connection scaling). Full CA verification needs a small adapter change.
3. **Admin console placement** — skip, co-locate on the EC2 host, or run separately.
4. **Compute choice** — plain EC2 + Docker for now; ECS Fargate / App Runner are
   alternatives if container orchestration becomes preferable.

## Status

- [x] Target architecture diagram (this document)
- [ ] Terraform modules (VPC, EC2, Aurora Serverless v2, S3, IAM instance role, security groups)
- [ ] Deployment runbook

# Dify Integration Kubernetes Baseline

`dify-integration-baseline.yaml` is an inert P0 reference for operators who already deploy Dify
with Kubernetes. Dify does not maintain a first-party Helm chart in this repository, so this file
only defines the KnowledgeFS boundary that a downstream chart must preserve:

- one `knowledge-fs-api` Deployment and internal `ClusterIP` Service;
- `/health` for startup/liveness and `/ready` for traffic readiness;
- same-namespace ingress only from pods labelled `app.kubernetes.io/part-of=dify`;
- Dify model, datasource, and unified object-storage access at `http://api:5001` plus a
  Secret-provided `DIFY_INNER_API_KEY` matching Dify's `INNER_API_KEY_FOR_PLUGIN`;
- no Ingress, LoadBalancer, NodePort, data migration job, or product route.

The Deployment is committed with `replicas: 0`. Keep it there until Capability v2 supplies a
production verifier. The baseline keeps Capability v2, integrated mode, direct upload, and direct
streaming explicitly disabled, so any unchanged pod reports `503` from `/ready` even if `/health`
is `200`.

Before a later controlled scale-up, replace the image with an immutable digest and create the
`knowledge-fs-runtime` Secret with dedicated `DATABASE_URL` and `DIFY_INNER_API_KEY`. Model,
datasource, and object-storage credentials stay in Dify and are never copied into KnowledgeFS.
The configured Dify storage backend must support recursive `scan`.
Add only the public Capability-v2 JWKS to the KFS Secret; its private signing key
belongs exclusively to Dify. Set the ConfigMap capability flags only after migrations and readiness
checks pass, and keep Dify's product/lifecycle flags disabled until the per-Workspace cutover gate
is ready. Apply KnowledgeFS migrations separately through its migration runner; this baseline never
creates, reuses, or migrates Dify Dataset/Document data.

The NetworkPolicy intentionally limits ingress only. Egress remains cluster/platform-owned because
database, parser, and Dify inner-runtime destinations differ between deployments. In integrated
mode KnowledgeFS does not connect directly to the object store. A downstream default-deny policy
must explicitly allow those dependencies.

---
title: Release Plan — Dify v1.17
status: draft
owner: TBD
updated: 2026-09-20
---

# Release Plan — Dify v1.17

> **Reconstructed, and thin by necessity.** v1.17 already shipped; what follows is what the repository can say about
> how a release happens, not a plan for one.

## What ships together

`api`, `web` and `cli` all carry version `1.17.1` [D: api/pyproject.toml:3; web/package.json; cli/package.json].
Four container images are published: api, web, agent backend, agent runtime [D: .github/workflows/docker-build.yml].

I: these three packages are released as one product version — basis: three independently publishable packages carry
an identical version string while the private workspace packages do not [D: packages/contracts/package.json].

## Release machinery present

| Workflow | Role |
| --- | --- |
| `build-push.yml`, `docker-build.yml` | build and publish images |
| `deploy-dev.yml`, `deploy-saas.yml`, `deploy-enterprise.yml`, `deploy-knowledge.yml`, `deploy-agent.yml` | deploy per surface |
| `cli-release.yml`, `cli-edge.yml` | release the CLI separately |
| `hotfix-cherry-pick.yml` | move a fix onto a release branch |

[D: .github/workflows/]

I: a release-branch model with cherry-picked hotfixes is in use — basis: a dedicated `hotfix-cherry-pick` workflow
exists, which only makes sense when a release line diverges from `main` [D: .github/workflows/hotfix-cherry-pick.yml].

## Open questions

- OPEN: what is the cadence, and what triggers a release? The repository carries no tags, so no release leaves a mark
  in it [D: `git tag` — empty].
- OPEN: what are the release gates beyond CI passing? Who signs off?
- OPEN: how are the CLI's independent releases coordinated with the server's, given the CLI enforces a compatibility
  check against the server [D: cli/src/commands/version/index.ts:56]?
- OPEN: what is the rollback plan for a bad release?

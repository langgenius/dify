# Nexoraa Credits Platform — Issue Dependency Map

```mermaid
flowchart TD
    START([🚀 START HERE]) --> W1

    subgraph W1["Week 1 — Schema & Services Foundation"]
        ENG4["ENG-4\nCore DB tables, RLS, indexes\n👤 Saahithi"]
        ENG5["ENG-5\ncost_model_versions + seed\n👤 Saahithi"]
        ENG6["ENG-6\nEvent schema v1.0 + ingest API\n👤 Nithilesh"]
        ENG7["ENG-7\nTenant + Subscription Service\n👤 Dinesh"]
        ENG8["ENG-8\nEntitlement Service + cache\n👤 Dinesh"]
    end

    subgraph W2["Week 2 — Wallet, Ledger & Execution Gateway"]
        ENG9["ENG-9\nWallet Service + optimistic locking\n👤 Saahithi"]
        ENG10["ENG-10\nLedger Service + immutability triggers\n👤 Saahithi"]
        ENG11["ENG-11\nBatch ingest + dedup + DLQ\n👤 Nithilesh"]
        ENG12["ENG-12\nEstimate/Reserve/Finalize + 6-check\n👤 Dinesh"]
        ENG13["ENG-13\nEnforcement modes (4 modes)\n👤 Dinesh"]
    end

    subgraph W3["Week 3 — Rating Engine & Approval"]
        ENG14["ENG-14\nRating Engine pure function\n👤 Narayana"]
        ENG15["ENG-15\nrating_decisions + settlement\n👤 Narayana"]
        ENG16["ENG-16\nStudio instrumentation + LLM wrapping\n👤 Nithilesh"]
        ENG17["ENG-17\nApproval Service state machine\n👤 Dinesh"]
        ENG18["ENG-18\nCatalog snapshot + RBAC foundation\n👤 Dinesh"]
    end

    subgraph W4["Week 4 — Reaper, Reconciliation & Admin"]
        ENG19["ENG-19\nReaper job (orphaned reservations)\n👤 Saahithi"]
        ENG20["ENG-20\nDaily reconciliation + monthly CSV\n👤 Saahithi"]
        ENG21["ENG-21\nTool call wrapping + catalog snapshot\n👤 Nithilesh"]
        ENG22["ENG-22\nAdmin endpoints + Financial RBAC\n👤 Dinesh"]
    end

    subgraph W5["Week 5 — Integration & Hardening"]
        ENG23["ENG-23\n⭐ E2E test: observe_only on real tenant\n👤 Narayana"]
        ENG24["ENG-24\nLoad test 200evt/s + DR drill\n👤 Narayana"]
        ENG25["ENG-25\nAdmin dashboard (internal)\n👤 Dinesh"]
        ENG26["ENG-26\nInvoice CSV+PDF + CloudWatch alarms\n👤 Saahithi"]
    end

    GATE1{{"🚦 Phase 1\nGo / No-Go\nENG-23 + ENG-24 must pass"}}

    subgraph P2["Phase 2 (Wks 6–9) — Advanced Rating & Controls"]
        ENG27["ENG-27\nHybrid + value_based models + fixtures\n👤 Narayana"]
        ENG28["ENG-28\nAnomaly detection + velocity caps\n👤 Nithilesh"]
        ENG29["ENG-29\nEnforcement mode ramp + margin dashboard\n👤 Dinesh"]
        ENG30["ENG-30\nFree-retry + failure charging + late events\n👤 Saahithi"]
        ENG31["ENG-31\nVendor cost reconciliation + drift alarms\n👤 Saahithi"]
    end

    GATE2{{"🚦 Phase 2\nGo / No-Go\nenforce_block live on ≥1 tenant"}}

    subgraph P3["Phase 3 (Wks 10–13) — Customer Billing & Compliance"]
        ENG32["ENG-32\nCustomer-facing dashboard\n👤 Dinesh"]
        ENG33["ENG-33\nStripe/Chargebee Billing Adapter\n👤 Nithilesh"]
        ENG34["ENG-34\nAuto-overage + top-up + notifications\n👤 Nithilesh"]
        ENG35["ENG-35\nSOC 2 Type I + DR runbook\n👤 Narayana"]
    end

    subgraph CROSS["Cross-Cutting — Security & Compliance Hardening"]
        ENG36["ENG-36\nmTLS service mesh + cert rotation\n👤 Nithilesh"]
        ENG37["ENG-37\nStripe webhook signature verification\n👤 Dinesh"]
        ENG38["ENG-38\nbilling=false guard + sandbox filtering\n👤 Narayana"]
        ENG39["ENG-39\nPII scrubbing middleware (log sanitization)\n👤 Saahithi"]
        ENG40["ENG-40\nRollover policy engine (expire/rollover/capped)\n👤 Saahithi"]
        ENG41["ENG-41\nASC 606 revenue recognition + deferred ledger\n👤 Narayana"]
    end

    END([✅ DONE — Credits Platform Live])

    %% ── Week 1 internal ──
    W1 --> ENG4 & ENG5 & ENG6 & ENG7
    ENG7 --> ENG8

    %% ── W1 → W2 ──
    ENG4 --> ENG9 & ENG10
    ENG5 --> ENG14
    ENG6 --> ENG11
    ENG7 --> ENG12
    ENG8 --> ENG12

    %% ── Week 2 internal ──
    ENG9 --> ENG10
    ENG9 --> ENG12
    ENG10 --> ENG12
    ENG12 --> ENG13

    %% ── W2 → W3 ──
    ENG9  --> ENG19
    ENG10 --> ENG19 & ENG20
    ENG11 --> ENG16 & ENG21
    ENG12 --> ENG17 & ENG18
    ENG14 --> ENG15
    ENG5  --> ENG14

    %% ── Week 3 internal ──
    ENG18 --> ENG17

    %% ── W3 → W4 ──
    ENG15 --> ENG20 & ENG23
    ENG16 --> ENG21
    ENG17 --> ENG22
    ENG18 --> ENG21 & ENG22

    %% ── Week 4 internal ──
    ENG20 --> ENG26

    %% ── W4 → W5 ──
    ENG19 --> ENG23
    ENG20 --> ENG24
    ENG21 --> ENG23
    ENG22 --> ENG25

    %% ── W5 → Gate 1 ──
    ENG23 --> GATE1
    ENG24 --> GATE1
    ENG25 --> GATE1
    ENG26 --> GATE1

    %% ── Gate 1 → Phase 2 ──
    GATE1 -->|pass| ENG27 & ENG28 & ENG29 & ENG30 & ENG31

    %% ── Phase 2 cross-links ──
    ENG13 --> ENG29
    ENG27 --> ENG29
    ENG28 --> ENG29
    ENG28 --> ENG34
    ENG20 --> ENG31

    %% ── Phase 2 → Gate 2 ──
    ENG27 --> GATE2
    ENG28 --> GATE2
    ENG29 --> GATE2
    ENG30 --> GATE2
    ENG31 --> GATE2

    %% ── Gate 2 → Phase 3 ──
    GATE2 -->|pass| ENG32 & ENG33 & ENG34 & ENG35

    %% ── Phase 3 cross-links ──
    ENG26 --> ENG33
    ENG30 --> ENG33
    ENG32 --> ENG34
    ENG31 --> ENG35
    ENG33 --> ENG35
    ENG34 --> ENG35

    %% ── Phase 3 → Done ──
    ENG35 --> END

    %% ── Cross-cutting dependencies ──
    ENG7  --> ENG36
    ENG36 --> ENG33
    ENG33 --> ENG37
    ENG12 --> ENG38
    ENG38 --> ENG23
    ENG6  --> ENG39
    ENG39 --> ENG26
    ENG9  --> ENG40
    ENG40 --> ENG20
    ENG15 --> ENG41
    ENG41 --> ENG35

    %% ── Styles ──
    classDef saahithi fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef nithilesh fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef dinesh fill:#fef9c3,stroke:#ca8a04,color:#713f12
    classDef narayana fill:#fce7f3,stroke:#db2777,color:#831843
    classDef gate fill:#f3f4f6,stroke:#374151,color:#111827,shape:diamond
    classDef epic fill:#1e1b4b,stroke:#4338ca,color:#e0e7ff
    classDef startend fill:#022c22,stroke:#059669,color:#d1fae5

    class ENG4,ENG5,ENG9,ENG10,ENG19,ENG20,ENG26,ENG30,ENG31,ENG39,ENG40 saahithi
    class ENG6,ENG11,ENG16,ENG21,ENG28,ENG33,ENG34,ENG36 nithilesh
    class ENG7,ENG8,ENG12,ENG13,ENG17,ENG18,ENG22,ENG25,ENG29,ENG32,ENG37 dinesh
    class ENG14,ENG15,ENG23,ENG24,ENG27,ENG35,ENG38,ENG41 narayana
    class GATE1,GATE2 gate
    class START,END startend
```

---

## Reading the Map

| Colour | Owner | Track |
|--------|-------|-------|
| 🔵 Blue | Saahithi | Data Model (DB, Wallet, Ledger, Reconciliation) |
| 🟢 Green | Nithilesh | Instrumentation (Event pipeline, LLM/tool wrapping, Billing adapter) |
| 🟡 Yellow | Dinesh | Gateway (Execution control, Approvals, Admin, Customer dashboard) |
| 🩷 Pink | Narayana | Rating Engine + Architecture oversight |

## Critical Path (longest chain to END)

```
START → ENG-4 → ENG-9 → ENG-10 → ENG-20 → ENG-26 → ENG-33 → ENG-35 → END
```
The ledger is the foundation of everything — delay ENG-10 and every downstream issue slips.

## Phase Gates

| Gate | What must be true to proceed |
|------|------------------------------|
| 🚦 Phase 1 | ENG-23 (E2E test) passes + ENG-24 (load test + DR drill) passes |
| 🚦 Phase 2 | ENG-29 confirms `enforce_block` live on ≥1 production tenant |

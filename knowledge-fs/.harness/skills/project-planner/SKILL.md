---
name: project-planner
description: |
  Breaks down complex projects into actionable tasks with timelines, dependencies, and milestones.
  Use when: planning projects, creating task breakdowns, defining milestones, estimating timelines,
  managing dependencies, or when user mentions project planning, roadmap, work breakdown, or task estimation.
license: MIT
metadata:
  author: awesome-llm-apps
  version: "1.0.0"
---

# Project Planner

You are an expert project planner who breaks down complex projects into achievable, well-structured tasks.

## When to Apply

Use this skill when:
- Defining project scope and deliverables
- Creating work breakdown structures (WBS)
- Identifying task dependencies
- Estimating timelines and effort
- Planning milestones and phases
- Allocating resources
- Risk assessment and mitigation

## Planning Process

### 1. **Define Success**
- What is the end goal?
- What are the success criteria?
- What defines "done"?
- What are the constraints (time, budget, resources)?

### 2. **Identify Deliverables**
- What are the major outputs?
- What milestones mark progress?
- What dependencies exist?
- What can be parallelized?

### 3. **Break Down Tasks**
- Each task: 2-8 hours of work
- Clear "done" criteria
- Assignable to single owner
- Testable/verifiable completion

### 4. **Map Dependencies**
- What must be done first?
- What can happen in parallel?
- What are the critical path items?
- Where are the bottlenecks?

### 5. **Estimate and Buffer**
- Best case, likely case, worst case
- Add 20-30% buffer for unknowns
- Account for review/testing time
- Include contingency for risks

### 6. **Assign and Track**
- Who owns each task?
- What skills are required?
- How will progress be tracked?
- When are check-ins scheduled?

## Task Sizing Guidelines

**Too Large** (>2 days):
- Break into subtasks
- Hard to estimate accurately
- Difficult to track progress  
- Blocks other work too long

**Well-Sized** (2-8 hours):
- Clear deliverable
- One person can complete
- Progress visible daily
- Easy to estimate

**Too Small** (<1 hour):
- May be over-planning
- Too much overhead
- Combine related micro-tasks

## Output Format

```markdown
## Project: [Name]

**Goal**: [Clear end state]
**Timeline**: [Duration]
**Team**: [People and roles]
**Constraints**: [Budget, tech, deadlines]

---

## Milestones

| # | Milestone | Target Date | Owner | Success Criteria |
|---|-----------|-------------|-------|------------------|
| 1 | [Name] | [Date] | [Person] | [How you know it's done] |

---

## Phase 1: [Phase Name] (Timeline)

| Task | Effort | Owner | Depends On | Done Criteria |
|------|--------|-------|------------|---------------|
| [Task name] | [Hours] | [Person] | [Dependencies] | [Definition of done] |

## Phase 2: [Phase Name] (Timeline)
[Continue for each phase]

---

## Dependencies Map

```
[Task A] ──> [Task B] ──> [Task D]
              ├──> [Task C] ──┘
```

---

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| [Risk description] | High/Med/Low | High/Med/Low | [How to prevent/reduce] |

---

## Resource Allocation

| Role | Hours/Week | Key Responsibilities |
|------|------------|---------------------|
| [Role] | [Hours] | [What they focus on] |
```

## Estimation Techniques

### Three-Point Estimation
```
Optimistic (O): Best case scenario
Most Likely (M): Expected case
Pessimistic (P): Worst case scenario

Expected = (O + 4M + P) / 6
```

### T-Shirt Sizing
- **XS**: < 2 hours
- **S**: 2-4 hours
- **M**: 4-8 hours (1 day)
- **L**: 2-3 days
- **XL**: 1 week

*Break down anything larger than XL*

### Planning Poker
For team estimation, use Fibonacci: 1, 2, 3, 5, 8, 13 story points

## Example

**User Request:** "Plan a website redesign. Team: 1 designer, 2 developers. Deadline: 6 weeks."

**Response:**

## Project: Company Website Redesign

**Goal**: Launch redesigned website with improved UX and modern design
**Timeline**: 6 weeks
**Team**: 1 designer, 2 developers
**Constraints**: Must maintain all existing functionality, no budget for new tools

---

## Milestones

| # | Milestone | Target Date | Owner | Success Criteria |
|---|-----------|-------------|-------|-------------------|
| 1 | Design Approved | End Week 2 | Designer | Stakeholders sign off on mockups |
| 2 | Development Complete | End Week 5 | Dev Team | All pages functional in staging |
| 3 | Launch | End Week 6 | All | Site live, no critical bugs |

---

## Phase 1: Discovery & Design (Weeks 1-2)

| Task | Effort | Owner | Depends On | Done Criteria |
|------|--------|-------|------------|---------------|
| Audit current site | 4h | Designer | - | List of pages, features, pain points |
| Stakeholder interviews | 4h | Designer | - | Requirements doc with priorities |
| Create sitemap | 2h | Designer | Audit | Updated sitemap approved |
| Design wireframes | 8h | Designer | Sitemap | Lo-fi wireframes for all pages |
| Design homepage mockup | 8h | Designer | Wireframes | Hi-fi mockup with branding |
| Design page templates | 12h | Designer | Homepage | Templates for all page types |
| Design review & revisions | 8h | Designer | Templates | Stakeholder approval received |

**Total Effort**: 46 hours (~6 days for 1 designer)

---

## Phase 2: Development Setup (Week 3)

| Task | Effort | Owner | Depends On | Done Criteria |
|------|--------|-------|------------|---------------|
| Set up dev environment | 4h | Dev 1 | - | Local dev working, Git repo ready |
| Choose tech stack | 2h | Dev 1 | - | Decision doc: framework, libraries |
| Set up CI/CD pipeline | 4h | Dev 1 | Dev env | auto-deploy to staging on merge |
| Create component library | 12h | Dev 1 | Design approval | Reusable components built |
| Set up CMS | 6h | Dev 2 | Tech stack | CMS installed, admin access working |

**Total Effort**: 28 hours (~3.5 days for 2 devs)

---

## Phase 3: Page Development (Weeks 4-5)

| Task | Effort | Owner | Depends On | Done Criteria |
|------|--------|-------|------------|---------------|
| Develop homepage | 16h | Dev 2 | Components | Homepage matches design, responsive |
| Develop about page | 8h | Dev 1 | Homepage | Page complete, responsive |
| Develop service pages | 16h | Dev 1+2 | Homepage | All service pages done |
| Develop blog template | 12h | Dev 2 | Components | Blog posts display correctly |
| Develop contact page | 6h | Dev 1 | About page | Form working, sends emails |
| CMS integration | 12h | Dev 2 | All pages | Content editable in CMS |
| Mobile responsive testing | 8h | Dev 1 | All pages | Works on mobile/tablet/desktop |
| Cross-browser testing | 6h | Dev 2 | Responsive | Works in Chrome, Firefox, Safari, Edge |

**Total Effort**: 84 hours (~10 days for 2 devs)

---

## Phase 4: QA & Launch (Week 6)

| Task | Effort | Owner | Depends On | Done Criteria |
|------|--------|-------|------------|---------------|
| Content migration | 8h | Dev 2 | CMS ready | All content moved to new site |
| SEO optimization | 4h | Dev 1 | Migration | Meta tags, sitemaps, redirects |
| Performance optimization | 6h | Dev 1 | All pages | Lighthouse score >90 |
| User acceptance testing | 8h | Designer+Devs | Migration | Stakeholders test and approve |
| Bug fixes | 12h | Devs | UAT | All critical/high bugs fixed |
| DNS/hosting setup | 2h | Dev 1 | Bug fixes | Domain points to new site |
| Launch & monitoring | 4h | All | Everything | Site live, analytics working |
| Post-launch fixes | 8h | Devs | Launch | Address any immediate issues |

**Total Effort**: 52 hours (~6.5 days for 2 devs + designer)

---

## Dependencies Visualization

```
Design Approval ──> Components ──> Homepage ──> Other Pages ──> Testing ──> Launch
                    └──> CMS ────────────────────┘
```

**Critical Path**: Design Approval → Components → Homepage → Other Pages → Testing → Launch

---

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Design feedback delays | High | Medium | Schedule reviews in advance, limit revision rounds to 2 |
| Scope creep | High | High | Lock requirements after Week 1, document any new requests for Phase 2 |
| Content not ready | Medium | Medium | Start content migration early (Week 4), use placeholders if needed |
| Technical issues | Medium | Low | Leave buffer in Week 5-6, have backup plan for hosting |
| Team member sick | Medium | Low | Cross-train devs, designer can do basic HTML/CSS if needed |

---

## Resource Allocation

| Role | Hours/Week | Weeks Active | Key Responsibilities |
|------|------------|--------------|----------------------|
| Designer | 40h | Weeks 1-2, 6 | Design, stakeholder management, UAT |
| Developer 1 | 40h | Weeks 3-6 | Architecture, dev setup, page development |
| Developer 2 | 40h | Weeks 3-6 | CMS, page development, testing |

**Total Effort**: ~210 hours across 6 weeks

---

## Weekly Checkpoints

- **Monday standup**: Progress updates, blockers
- **Friday review**: Demo completed work, plan next week
- **Weeks 2, 4, 6**: Milestone reviews with stakeholders

---

## Success Metrics

- Launch on time (Week 6)
- No critical bugs at launch
- Lighthouse performance score >90
- Stakeholder approval on design
- All existing functionality maintained

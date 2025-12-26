# Testing Workflow Guide

This guide defines the workflow for generating tests, especially for complex components or directories with multiple files.

## Scope Clarification

This guide addresses **multi-file workflow** (how to process multiple test files). For coverage requirements within a single test file, see `web/testing/testing.md` § Coverage Goals.

| Scope | Rule |
|-------|------|
| **Single file** | Complete coverage in one generation (100% function, >95% branch) |
| **Multi-file directory** | Process one file at a time, verify each before proceeding |

## ⚠️ Critical Rule: Incremental Approach for Multi-File Testing

When testing a **directory with multiple files**, **NEVER generate all test files at once.** Use an incremental, verify-as-you-go approach.

### Why Incremental?

| Batch Approach (❌) | Incremental Approach (✅) |
|---------------------|---------------------------|
| Generate 5+ tests at once | Generate 1 test at a time |
| Run tests only at the end | Run test immediately after each file |
| Multiple failures compound | Single point of failure, easy to debug |
| Hard to identify root cause | Clear cause-effect relationship |
| Mock issues affect many files | Mock issues caught early |
| Messy git history | Clean, atomic commits possible |

## Single File Workflow

When testing a **single component, hook, or utility**:

```
1. Read source code completely
2. Run `pnpm analyze-component <path>` (if available)
3. Check complexity score and features detected
4. Write the test file
5. Run test: `pnpm test <file>.spec.tsx`
6. Fix any failures
7. Verify coverage meets goals (100% function, >95% branch)
```

## Directory/Multi-File Workflow (MUST FOLLOW)

When testing a **directory or multiple files**, follow this strict workflow:

### Step 1: Analyze and Plan

1. **List all files** that need tests in the directory
1. **Categorize by complexity**:
   - 🟢 **Simple**: Utility functions, simple hooks, presentational components
   - 🟡 **Medium**: Components with state, effects, or event handlers
   - 🔴 **Complex**: Components with API calls, routing, or many dependencies
1. **Order by dependency**: Test dependencies before dependents
1. **Create a todo list** to track progress

### Step 2: Determine Processing Order

Process files in this recommended order:

```
1. Utility functions (simplest, no React)
2. Custom hooks (isolated logic)
3. Simple presentational components (few/no props)
4. Medium complexity components (state, effects)
5. Complex components (API, routing, many deps)
6. Container/index components (integration tests - last)
```

**Rationale**:

- Simpler files help establish mock patterns
- Hooks used by components should be tested first
- Integration tests (index files) depend on child components working

### Step 3: Process Each File Incrementally

**For EACH file in the ordered list:**

```
┌─────────────────────────────────────────────┐
│  1. Write test file                         │
│  2. Run: pnpm test <file>.spec.tsx          │
│  3. If FAIL → Fix immediately, re-run       │
│  4. If PASS → Mark complete in todo list    │
│  5. ONLY THEN proceed to next file          │
└─────────────────────────────────────────────┘
```

**DO NOT proceed to the next file until the current one passes.**

### Step 4: Final Verification

After all individual tests pass:

```bash
# Run all tests in the directory together
pnpm test path/to/directory/

# Check coverage
pnpm test:coverage path/to/directory/
```

## Component Complexity Guidelines

Use `pnpm analyze-component <path>` to assess complexity before testing.

### 🔴 Very Complex Components (Complexity > 50)

**Consider refactoring BEFORE testing:**

- Break component into smaller, testable pieces
- Extract complex logic into custom hooks
- Separate container and presentational layers

**If testing as-is:**

- Use integration tests for complex workflows
- Use `test.each()` for data-driven testing
- Multiple `describe` blocks for organization
- Consider testing major sections separately

### 🟡 Medium Complexity (Complexity 30-50)

- Group related tests in `describe` blocks
- Test integration scenarios between internal parts
- Focus on state transitions and side effects
- Use helper functions to reduce test complexity

### 🟢 Simple Components (Complexity < 30)

- Standard test structure
- Focus on props, rendering, and edge cases
- Usually straightforward to test

### 📏 Large Files (500+ lines)

Regardless of complexity score:

- **Strongly consider refactoring** before testing
- If testing as-is, test major sections separately
- Create helper functions for test setup
- May need multiple test files

## Todo List Format

When testing multiple files, use a todo list like this:

```
Testing: path/to/directory/

Ordered by complexity (simple → complex):

☐ utils/helper.ts           [utility, simple]
☐ hooks/use-custom-hook.ts  [hook, simple]
☐ empty-state.tsx           [component, simple]
☐ item-card.tsx             [component, medium]
☐ list.tsx                  [component, complex]
☐ index.tsx                 [integration]

Progress: 0/6 complete
```

Update status as you complete each:

- ☐ → ⏳ (in progress)
- ⏳ → ✅ (complete and verified)
- ⏳ → ❌ (blocked, needs attention)

## When to Stop and Verify

**Always run tests after:**

- Completing a test file
- Making changes to fix a failure
- Modifying shared mocks
- Updating test utilities or helpers

**Signs you should pause:**

- More than 2 consecutive test failures
- Mock-related errors appearing
- Unclear why a test is failing
- Test passing but coverage unexpectedly low

## Common Pitfalls to Avoid

### ❌ Don't: Generate Everything First

```
# BAD: Writing all files then testing
Write component-a.spec.tsx
Write component-b.spec.tsx  
Write component-c.spec.tsx
Write component-d.spec.tsx
Run pnpm test  ← Multiple failures, hard to debug
```

### ✅ Do: Verify Each Step

```
# GOOD: Incremental with verification
Write component-a.spec.tsx
Run pnpm test component-a.spec.tsx ✅
Write component-b.spec.tsx
Run pnpm test component-b.spec.tsx ✅
...continue...
```

### ❌ Don't: Skip Verification for "Simple" Components

Even simple components can have:

- Import errors
- Missing mock setup
- Incorrect assumptions about props

**Always verify, regardless of perceived simplicity.**

### ❌ Don't: Continue When Tests Fail

Failing tests compound:

- A mock issue in file A affects files B, C, D
- Fixing A later requires revisiting all dependent tests
- Time wasted on debugging cascading failures

**Fix failures immediately before proceeding.**

## Integration with Claude's Todo Feature

When using Claude for multi-file testing:

1. **Ask Claude to create a todo list** before starting
1. **Request one file at a time** or ensure Claude processes incrementally
1. **Verify each test passes** before asking for the next
1. **Mark todos complete** as you progress

Example prompt:

```
Test all components in `path/to/directory/`.
First, analyze the directory and create a todo list ordered by complexity.
Then, process ONE file at a time, waiting for my confirmation that tests pass
before proceeding to the next.
```

## Summary Checklist

Before starting multi-file testing:

- [ ] Listed all files needing tests
- [ ] Ordered by complexity (simple → complex)
- [ ] Created todo list for tracking
- [ ] Understand dependencies between files

During testing:

- [ ] Processing ONE file at a time
- [ ] Running tests after EACH file
- [ ] Fixing failures BEFORE proceeding
- [ ] Updating todo list progress

After completion:

- [ ] All individual tests pass
- [ ] Full directory test run passes
- [ ] Coverage goals met
- [ ] Todo list shows all complete

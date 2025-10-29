# Web Scripts

Frontend development utility scripts.

## 📋 Scripts

- `generate-icons.js` - Generate PWA icons
- `optimize-standalone.js` - Optimize build output  
- `analyze-component.js` - **Test generation helper** ⭐

---

## 🚀 Generate Tests (Using AI Assistants)

### Quick Start

```bash
# 1. Analyze component
pnpm test:gen app/components/base/button/index.tsx

# Output: Component analysis + AI prompt (auto-copied to clipboard)

# 2. Paste in your AI assistant:
#    - Cursor: Cmd+L (Chat) or Cmd+I (Composer) → Cmd+V → Enter
#    - GitHub Copilot Chat: Cmd+I → Cmd+V → Enter
#    - Claude/ChatGPT: Paste the prompt directly

# 3. Apply the generated test and verify
pnpm test app/components/base/button/index.spec.tsx
```

**Done in < 1 minute!** ✅

---

## 📊 How It Works

### Component Complexity

Script analyzes and scores components:

- **0-10**: 🟢 Simple (5-10 min to test)
- **11-30**: 🟡 Medium (15-30 min to test)  
- **31-50**: 🟠 Complex (30-60 min to test)
- **51+**: 🔴 Very Complex (60+ min, consider refactoring)

### Test Scenarios

Defined in `TESTING.md`:

**Must test**: Rendering, Props, Edge Cases  
**Conditional**: State, Effects, Events, API calls, Routing  
**Optional**: Accessibility, Performance, Snapshots

AI assistant auto-selects scenarios based on component features.

---

## 💡 Daily Workflow

```bash
# New component
pnpm test:gen app/components/new-feature/index.tsx
# → Paste in AI assistant → Apply → Done

# Quick shortcuts:
# Cursor users: Cmd+I → "Generate test for [file]" → Apply
# Copilot users: Cmd+I → Paste prompt → Accept
# Others: Copy prompt → Paste in your AI tool
```

---

## 📋 Commands

```bash
pnpm test:gen <path>        # Generate test
pnpm test [file]            # Run tests
pnpm test --coverage        # View coverage
pnpm lint                   # Code check
pnpm type-check             # Type check
```

---

## 🎯 Customize

Edit testing standards for your team:

```bash
# Complete testing guide (for all team members)
code web/scripts/TESTING.md

# Quick reference for Cursor users
code .cursorrules

# Commit your changes
git commit -m "docs: update test standards"
```

---

## 📚 Resources

- **Testing Guide**: [TESTING.md](./TESTING.md) - Complete testing specifications
- **Quick Reference**: [.cursorrules](../../.cursorrules) - For Cursor users
- **Examples**: [classnames.spec.ts](../utils/classnames.spec.ts), [button/index.spec.tsx](../app/components/base/button/index.spec.tsx)


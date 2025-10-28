# Web Scripts

Frontend development utility scripts.

## 📋 Scripts

- `generate-icons.js` - Generate PWA icons
- `optimize-standalone.js` - Optimize build output  
- `analyze-component.js` - **Test generation helper** ⭐

---

## 🚀 Generate Tests (Using Cursor AI)

### Quick Start

```bash
# 1. Analyze component
pnpm test:gen app/components/base/button/index.tsx

# Output: Component analysis + Cursor prompt (auto-copied)

# 2. In Cursor: Cmd+L → Cmd+V → Enter → Apply

# 3. Verify
pnpm test app/components/base/button/index.spec.tsx
```

**Done in < 1 minute!** ✅

---

## 📊 How It Works

### Component Complexity

Script analyzes and scores components:

- **0-10**: 🟢 Simple (5-10 min to test)
- **11-30Menu 🟡 Medium (15-30 min to test)  
- **31-50Menu 🟠 Complex (30-60 min to test)
- **51+**: 🔴 Very Complex (60+ min, consider refactoring)

### Test Scenarios (11 types)

Defined in `.cursorrules`:

**Must test**: Rendering, Props, Edge Cases  
**CommonMenuInteractions, Accessibility, i18n, Async  
**OptionalMenuState, Security, Performance, Snapshots

Cursor AI auto-selects scenarios based on component features.

---

## 💡 Daily Workflow

```bash
# New component
pnpm test:gen app/components/new-feature/index.tsx
# → Cursor → Apply → Done

# Or even simpler in Cursor
# Cmd+I → "Generate test" → Apply
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

Edit `.cursorrules` to modify test standards for your team.

```bash
code .cursorrules
git commit -m "docs: update test rules"
```


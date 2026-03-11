---
name: component-refactoring
description: Refactor high-complexity React components in Dify frontend. Use when `pnpm analyze-component --json` shows complexity > 50 or lineCount > 300, when the user asks for code splitting, hook extraction, or complexity reduction, or when `pnpm analyze-component` warns to refactor before testing; avoid for simple/well-structured components, third-party wrappers, or when the user explicitly wants testing without refactoring.
---

# Dify Component Refactoring Skill

Refactor high-complexity React components in the Dify frontend codebase with the patterns and workflow below.

> **Complexity Threshold**: Components with complexity > 50 (measured by `pnpm analyze-component`) should be refactored before testing.

## Quick Reference

### Commands (run from `web/`)

Use paths relative to `web/` (e.g., `app/components/...`).
Use `refactor-component` for refactoring prompts and `analyze-component` for testing prompts and metrics.

```bash
cd web

# Generate refactoring prompt
pnpm refactor-component <path>

# Output refactoring analysis as JSON
pnpm refactor-component <path> --json

# Generate testing prompt (after refactoring)
pnpm analyze-component <path>

# Output testing analysis as JSON
pnpm analyze-component <path> --json
```

### Complexity Analysis

```bash
# Analyze component complexity
pnpm analyze-component <path> --json

# Key metrics to check:
# - complexity: normalized score 0-100 (target < 50)
# - maxComplexity: highest single function complexity
# - lineCount: total lines (target < 300)
```

### Complexity Score Interpretation

| Score | Level | Action |
|-------|-------|--------|
| 0-25 | 🟢 Simple | Ready for testing |
| 26-50 | 🟡 Medium | Consider minor refactoring |
| 51-75 | 🟠 Complex | **Refactor before testing** |
| 76-100 | 🔴 Very Complex | **Must refactor** |

## Core Refactoring Patterns

### Pattern 1: Extract Custom Hooks

Place hooks in a `hooks/` subdirectory or alongside the component as `use-<feature>.ts`.

```typescript
// ❌ Before: 50+ lines of state logic in component
const Configuration: FC = () => {
  const [modelConfig, setModelConfig] = useState<ModelConfig>(...)
  const [completionParams, setCompletionParams] = useState<FormValue>({})
  // ...state management logic mixed with UI
}

// ✅ After: hooks/use-model-config.ts
export const useModelConfig = (appId: string) => {
  const [modelConfig, setModelConfig] = useState<ModelConfig>(...)
  const [completionParams, setCompletionParams] = useState<FormValue>({})
  return { modelConfig, setModelConfig, completionParams, setCompletionParams }
}
```

**Dify examples**: `web/app/components/app/configuration/hooks/`, `web/app/components/workflow/hooks/use-workflow.ts`

### Pattern 2: Extract Sub-Components

Split monolithic JSX into focused files in the same directory.

```typescript
// ✅ After: app-info/
//   ├── index.tsx           (orchestration only)
//   ├── app-header.tsx      (header UI)
//   ├── app-operations.tsx  (operations UI)
//   └── app-modals.tsx      (modal management)
```

**Dify examples**: `web/app/components/app/configuration/`, `web/app/components/workflow/nodes/`

### Pattern 3: Simplify Conditional Logic

Replace deep nesting (> 3 levels), complex ternaries, or `if/else` chains with lookup tables and early returns.

```typescript
// ✅ After: Use lookup tables
const TEMPLATE_MAP = {
  [AppModeEnum.CHAT]: {
    [LanguagesSupported[1]]: TemplateChatZh,
    default: TemplateChatEn,
  },
}
const Template = useMemo(() => {
  const modeTemplates = TEMPLATE_MAP[appDetail?.mode]
  if (!modeTemplates) return null
  return (modeTemplates[locale] || modeTemplates.default)
}, [appDetail, locale])
```

### Pattern 4: Extract API/Data Logic

Use `@tanstack/react-query` hooks from `web/service/use-*.ts` instead of inline `useEffect` + `useState` for data fetching.

```typescript
// ✅ After: use-app-config.ts
export const useAppConfig = (appId: string, isBasicApp: boolean) => {
  return useQuery({
    enabled: isBasicApp && !!appId,
    queryKey: ['appConfig', 'detail', appId],
    queryFn: () => get<AppDetailResponse>(`/apps/${appId}`),
    select: data => data?.model_config || {},
  })
}
```

**Best practices**: define `NAME_SPACE` for query keys, use `enabled` for conditional fetching, use `select` for transformation, export `useInvalidXxx` helpers.

**Dify examples**: `web/service/use-workflow.ts`, `web/service/knowledge/use-dataset.ts`

### Pattern 5: Extract Modal/Dialog Management

Replace multiple boolean `useState` calls with a single discriminated modal state hook.

```typescript
// ✅ After
type ModalType = 'edit' | 'duplicate' | 'delete' | 'switch' | 'import' | null
const useAppInfoModals = () => {
  const [activeModal, setActiveModal] = useState<ModalType>(null)
  return {
    activeModal,
    openModal: useCallback((type: ModalType) => setActiveModal(type), []),
    closeModal: useCallback(() => setActiveModal(null), []),
    isOpen: (type: ModalType) => activeModal === type,
  }
}
```

### Pattern 6: Extract Form Logic

Use `@tanstack/react-form` patterns from `web/app/components/base/form/`.

```typescript
// ✅ Use existing form infrastructure
import { useAppForm } from '@/app/components/base/form'
const form = useAppForm({
  defaultValues: { name: '', description: '' },
  onSubmit: handleSubmit,
})
```

## Dify-Specific Refactoring Guidelines

### 1. Context Provider Extraction

**When**: Component provides complex context values with multiple states.

```typescript
// ❌ Before: Large context value object
const value = {
  appId, isAPIKeySet, isTrailFinished, mode, modelModeType,
  promptMode, isAdvancedMode, isAgent, isOpenAI, isFunctionCall,
  // 50+ more properties...
}
return <ConfigContext.Provider value={value}>...</ConfigContext.Provider>

// ✅ After: Split into domain-specific contexts
<ModelConfigProvider value={modelConfigValue}>
  <DatasetConfigProvider value={datasetConfigValue}>
    <UIConfigProvider value={uiConfigValue}>
      {children}
    </UIConfigProvider>
  </DatasetConfigProvider>
</ModelConfigProvider>
```

**Dify Reference**: `web/context/` directory structure

### 2. Workflow Node Components

**When**: Refactoring workflow node components (`web/app/components/workflow/nodes/`).

**Conventions**:
- Keep node logic in `use-interactions.ts`
- Extract panel UI to separate files
- Use `_base` components for common patterns

```
nodes/<node-type>/
  ├── index.tsx              # Node registration
  ├── node.tsx               # Node visual component
  ├── panel.tsx              # Configuration panel
  ├── use-interactions.ts    # Node-specific hooks
  └── types.ts               # Type definitions
```

### 3. Configuration Components

**When**: Refactoring app configuration components.

**Conventions**:
- Separate config sections into subdirectories
- Use existing patterns from `web/app/components/app/configuration/`
- Keep feature toggles in dedicated components

### 4. Tool/Plugin Components

**When**: Refactoring tool-related components (`web/app/components/tools/`).

**Conventions**:
- Follow existing modal patterns
- Use service hooks from `web/service/use-tools.ts`
- Keep provider-specific logic isolated

## Refactoring Workflow

### Step 1: Generate Refactoring Prompt

```bash
pnpm refactor-component <path>
```

This command will:
- Analyze component complexity and features
- Identify specific refactoring actions needed
- Generate a prompt for AI assistant (auto-copied to clipboard on macOS)
- Provide detailed requirements based on detected patterns

### Step 2: Analyze Details

```bash
pnpm analyze-component <path> --json
```

Identify:
- Total complexity score
- Max function complexity
- Line count
- Features detected (state, effects, API, etc.)

### Step 3: Plan

Create a refactoring plan based on detected features:

| Detected Feature | Refactoring Action |
|------------------|-------------------|
| `hasState: true` + `hasEffects: true` | Extract custom hook |
| `hasAPI: true` | Extract data/service hook |
| `hasEvents: true` (many) | Extract event handlers |
| `lineCount > 300` | Split into sub-components |
| `maxComplexity > 50` | Simplify conditional logic |

### Step 4: Execute Incrementally

1. **Extract one piece at a time**
2. **Run lint, type-check, and tests after each extraction**
3. **Verify functionality before next step**

```
For each extraction:
  ┌────────────────────────────────────────┐
  │ 1. Extract code                        │
  │ 2. Run: pnpm lint:fix                  │
  │ 3. Run: pnpm type-check:tsgo           │
  │ 4. Run: pnpm test                      │
  │ 5. Test functionality manually         │
  │ 6. PASS? → Next extraction             │
  │    FAIL? → Fix before continuing       │
  └────────────────────────────────────────┘
```

### Step 5: Verify

After refactoring:

```bash
# Re-run refactor command to verify improvements
pnpm refactor-component <path>

# If complexity < 25 and lines < 200, you'll see:
# ✅ COMPONENT IS WELL-STRUCTURED

# For detailed metrics:
pnpm analyze-component <path> --json

# Target metrics:
# - complexity < 50
# - lineCount < 300
# - maxComplexity < 30
```

## Common Mistakes to Avoid

### ❌ Over-Engineering

```typescript
// ❌ Too many tiny hooks
const useButtonText = () => useState('Click')
const useButtonDisabled = () => useState(false)
const useButtonLoading = () => useState(false)

// ✅ Cohesive hook with related state
const useButtonState = () => {
  const [text, setText] = useState('Click')
  const [disabled, setDisabled] = useState(false)
  const [loading, setLoading] = useState(false)
  return { text, setText, disabled, setDisabled, loading, setLoading }
}
```

### ❌ Breaking Existing Patterns

- Follow existing directory structures
- Maintain naming conventions
- Preserve export patterns for compatibility

### ❌ Premature Abstraction

- Only extract when there's clear complexity benefit
- Don't create abstractions for single-use code
- Keep refactored code in the same domain area

## References

### Dify Codebase Examples

- **Hook extraction**: `web/app/components/app/configuration/hooks/`
- **Component splitting**: `web/app/components/app/configuration/`
- **Service hooks**: `web/service/use-*.ts`
- **Workflow patterns**: `web/app/components/workflow/hooks/`
- **Form patterns**: `web/app/components/base/form/`

### Related Skills

- `frontend-testing` - For testing refactored components
- `web/docs/test.md` - Testing specification

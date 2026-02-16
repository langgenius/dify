# Complexity Reduction Patterns

This document provides patterns for reducing cognitive complexity in Dify React components.

## Understanding Complexity

### SonarJS Cognitive Complexity

The `pnpm analyze-component` tool uses SonarJS cognitive complexity metrics:

- **Total Complexity**: Sum of all functions' complexity in the file
- **Max Complexity**: Highest single function complexity

### What Increases Complexity

| Pattern | Complexity Impact |
|---------|-------------------|
| `if/else` | +1 per branch |
| Nested conditions | +1 per nesting level |
| `switch/case` | +1 per case |
| `for/while/do` | +1 per loop |
| `&&`/`||` chains | +1 per operator |
| Nested callbacks | +1 per nesting level |
| `try/catch` | +1 per catch |
| Ternary expressions | +1 per nesting |

## Pattern 1: Replace Conditionals with Lookup Tables

**Before** (complexity: ~15):

```typescript
const Template = useMemo(() => {
  if (appDetail?.mode === AppModeEnum.CHAT) {
    switch (locale) {
      case LanguagesSupported[1]:
        return <TemplateChatZh appDetail={appDetail} />
      case LanguagesSupported[7]:
        return <TemplateChatJa appDetail={appDetail} />
      default:
        return <TemplateChatEn appDetail={appDetail} />
    }
  }
  if (appDetail?.mode === AppModeEnum.ADVANCED_CHAT) {
    switch (locale) {
      case LanguagesSupported[1]:
        return <TemplateAdvancedChatZh appDetail={appDetail} />
      case LanguagesSupported[7]:
        return <TemplateAdvancedChatJa appDetail={appDetail} />
      default:
        return <TemplateAdvancedChatEn appDetail={appDetail} />
    }
  }
  if (appDetail?.mode === AppModeEnum.WORKFLOW) {
    // Similar pattern...
  }
  return null
}, [appDetail, locale])
```

**After** (complexity: ~3):

```typescript
// Define lookup table outside component
const TEMPLATE_MAP: Record<AppModeEnum, Record<string, FC<TemplateProps>>> = {
  [AppModeEnum.CHAT]: {
    [LanguagesSupported[1]]: TemplateChatZh,
    [LanguagesSupported[7]]: TemplateChatJa,
    default: TemplateChatEn,
  },
  [AppModeEnum.ADVANCED_CHAT]: {
    [LanguagesSupported[1]]: TemplateAdvancedChatZh,
    [LanguagesSupported[7]]: TemplateAdvancedChatJa,
    default: TemplateAdvancedChatEn,
  },
  [AppModeEnum.WORKFLOW]: {
    [LanguagesSupported[1]]: TemplateWorkflowZh,
    [LanguagesSupported[7]]: TemplateWorkflowJa,
    default: TemplateWorkflowEn,
  },
  // ...
}

// Clean component logic
const Template = useMemo(() => {
  if (!appDetail?.mode) return null
  
  const templates = TEMPLATE_MAP[appDetail.mode]
  if (!templates) return null
  
  const TemplateComponent = templates[locale] ?? templates.default
  return <TemplateComponent appDetail={appDetail} />
}, [appDetail, locale])
```

## Pattern 2: Use Early Returns

**Before** (complexity: ~10):

```typescript
const handleSubmit = () => {
  if (isValid) {
    if (hasChanges) {
      if (isConnected) {
        submitData()
      } else {
        showConnectionError()
      }
    } else {
      showNoChangesMessage()
    }
  } else {
    showValidationError()
  }
}
```

**After** (complexity: ~4):

```typescript
const handleSubmit = () => {
  if (!isValid) {
    showValidationError()
    return
  }
  
  if (!hasChanges) {
    showNoChangesMessage()
    return
  }
  
  if (!isConnected) {
    showConnectionError()
    return
  }
  
  submitData()
}
```

## Pattern 3: Extract Complex Conditions

**Before** (complexity: high):

```typescript
const canPublish = (() => {
  if (mode !== AppModeEnum.COMPLETION) {
    if (!isAdvancedMode)
      return true

    if (modelModeType === ModelModeType.completion) {
      if (!hasSetBlockStatus.history || !hasSetBlockStatus.query)
        return false
      return true
    }
    return true
  }
  return !promptEmpty
})()
```

**After** (complexity: lower):

```typescript
// Extract to named functions
const canPublishInCompletionMode = () => !promptEmpty

const canPublishInChatMode = () => {
  if (!isAdvancedMode) return true
  if (modelModeType !== ModelModeType.completion) return true
  return hasSetBlockStatus.history && hasSetBlockStatus.query
}

// Clean main logic
const canPublish = mode === AppModeEnum.COMPLETION
  ? canPublishInCompletionMode()
  : canPublishInChatMode()
```

## Pattern 4: Replace Chained Ternaries

**Before** (complexity: ~5):

```typescript
const statusText = serverActivated
  ? t('status.running')
  : serverPublished
    ? t('status.inactive')
    : appUnpublished
      ? t('status.unpublished')
      : t('status.notConfigured')
```

**After** (complexity: ~2):

```typescript
const getStatusText = () => {
  if (serverActivated) return t('status.running')
  if (serverPublished) return t('status.inactive')
  if (appUnpublished) return t('status.unpublished')
  return t('status.notConfigured')
}

const statusText = getStatusText()
```

Or use lookup:

```typescript
const STATUS_TEXT_MAP = {
  running: 'status.running',
  inactive: 'status.inactive',
  unpublished: 'status.unpublished',
  notConfigured: 'status.notConfigured',
} as const

const getStatusKey = (): keyof typeof STATUS_TEXT_MAP => {
  if (serverActivated) return 'running'
  if (serverPublished) return 'inactive'
  if (appUnpublished) return 'unpublished'
  return 'notConfigured'
}

const statusText = t(STATUS_TEXT_MAP[getStatusKey()])
```

## Pattern 5: Flatten Nested Loops

**Before** (complexity: high):

```typescript
const processData = (items: Item[]) => {
  const results: ProcessedItem[] = []
  
  for (const item of items) {
    if (item.isValid) {
      for (const child of item.children) {
        if (child.isActive) {
          for (const prop of child.properties) {
            if (prop.value !== null) {
              results.push({
                itemId: item.id,
                childId: child.id,
                propValue: prop.value,
              })
            }
          }
        }
      }
    }
  }
  
  return results
}
```

**After** (complexity: lower):

```typescript
// Use functional approach
const processData = (items: Item[]) => {
  return items
    .filter(item => item.isValid)
    .flatMap(item =>
      item.children
        .filter(child => child.isActive)
        .flatMap(child =>
          child.properties
            .filter(prop => prop.value !== null)
            .map(prop => ({
              itemId: item.id,
              childId: child.id,
              propValue: prop.value,
            }))
        )
    )
}
```

## Pattern 6: Extract Event Handler Logic

**Before** (complexity: high in component):

```typescript
const Component = () => {
  const handleSelect = (data: DataSet[]) => {
    if (isEqual(data.map(item => item.id), dataSets.map(item => item.id))) {
      hideSelectDataSet()
      return
    }

    formattingChangedDispatcher()
    let newDatasets = data
    if (data.find(item => !item.name)) {
      const newSelected = produce(data, (draft) => {
        data.forEach((item, index) => {
          if (!item.name) {
            const newItem = dataSets.find(i => i.id === item.id)
            if (newItem)
              draft[index] = newItem
          }
        })
      })
      setDataSets(newSelected)
      newDatasets = newSelected
    }
    else {
      setDataSets(data)
    }
    hideSelectDataSet()
    
    // 40 more lines of logic...
  }
  
  return <div>...</div>
}
```

**After** (complexity: lower):

```typescript
// Extract to hook or utility
const useDatasetSelection = (dataSets: DataSet[], setDataSets: SetState<DataSet[]>) => {
  const normalizeSelection = (data: DataSet[]) => {
    const hasUnloadedItem = data.some(item => !item.name)
    if (!hasUnloadedItem) return data
    
    return produce(data, (draft) => {
      data.forEach((item, index) => {
        if (!item.name) {
          const existing = dataSets.find(i => i.id === item.id)
          if (existing) draft[index] = existing
        }
      })
    })
  }
  
  const hasSelectionChanged = (newData: DataSet[]) => {
    return !isEqual(
      newData.map(item => item.id),
      dataSets.map(item => item.id)
    )
  }
  
  return { normalizeSelection, hasSelectionChanged }
}

// Component becomes cleaner
const Component = () => {
  const { normalizeSelection, hasSelectionChanged } = useDatasetSelection(dataSets, setDataSets)
  
  const handleSelect = (data: DataSet[]) => {
    if (!hasSelectionChanged(data)) {
      hideSelectDataSet()
      return
    }
    
    formattingChangedDispatcher()
    const normalized = normalizeSelection(data)
    setDataSets(normalized)
    hideSelectDataSet()
  }
  
  return <div>...</div>
}
```

## Pattern 7: Reduce Boolean Logic Complexity

**Before** (complexity: ~8):

```typescript
const toggleDisabled = hasInsufficientPermissions
  || appUnpublished
  || missingStartNode
  || triggerModeDisabled
  || (isAdvancedApp && !currentWorkflow?.graph)
  || (isBasicApp && !basicAppConfig.updated_at)
```

**After** (complexity: ~3):

```typescript
// Extract meaningful boolean functions
const isAppReady = () => {
  if (isAdvancedApp) return !!currentWorkflow?.graph
  return !!basicAppConfig.updated_at
}

const hasRequiredPermissions = () => {
  return isCurrentWorkspaceEditor && !hasInsufficientPermissions
}

const canToggle = () => {
  if (!hasRequiredPermissions()) return false
  if (!isAppReady()) return false
  if (missingStartNode) return false
  if (triggerModeDisabled) return false
  return true
}

const toggleDisabled = !canToggle()
```

## Pattern 8: Simplify useMemo/useCallback Dependencies

**Before** (complexity: multiple recalculations):

```typescript
const payload = useMemo(() => {
  let parameters: Parameter[] = []
  let outputParameters: OutputParameter[] = []

  if (!published) {
    parameters = (inputs || []).map((item) => ({
      name: item.variable,
      description: '',
      form: 'llm',
      required: item.required,
      type: item.type,
    }))
    outputParameters = (outputs || []).map((item) => ({
      name: item.variable,
      description: '',
      type: item.value_type,
    }))
  }
  else if (detail && detail.tool) {
    parameters = (inputs || []).map((item) => ({
      // Complex transformation...
    }))
    outputParameters = (outputs || []).map((item) => ({
      // Complex transformation...
    }))
  }
  
  return {
    icon: detail?.icon || icon,
    label: detail?.label || name,
    // ...more fields
  }
}, [detail, published, workflowAppId, icon, name, description, inputs, outputs])
```

**After** (complexity: separated concerns):

```typescript
// Separate transformations
const useParameterTransform = (inputs: InputVar[], detail?: ToolDetail, published?: boolean) => {
  return useMemo(() => {
    if (!published) {
      return inputs.map(item => ({
        name: item.variable,
        description: '',
        form: 'llm',
        required: item.required,
        type: item.type,
      }))
    }
    
    if (!detail?.tool) return []
    
    return inputs.map(item => ({
      name: item.variable,
      required: item.required,
      type: item.type === 'paragraph' ? 'string' : item.type,
      description: detail.tool.parameters.find(p => p.name === item.variable)?.llm_description || '',
      form: detail.tool.parameters.find(p => p.name === item.variable)?.form || 'llm',
    }))
  }, [inputs, detail, published])
}

// Component uses hook
const parameters = useParameterTransform(inputs, detail, published)
const outputParameters = useOutputTransform(outputs, detail, published)

const payload = useMemo(() => ({
  icon: detail?.icon || icon,
  label: detail?.label || name,
  parameters,
  outputParameters,
  // ...
}), [detail, icon, name, parameters, outputParameters])
```

## Target Metrics After Refactoring

| Metric | Target |
|--------|--------|
| Total Complexity | < 50 |
| Max Function Complexity | < 30 |
| Function Length | < 30 lines |
| Nesting Depth | ≤ 3 levels |
| Conditional Chains | ≤ 3 conditions |

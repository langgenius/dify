# Component Splitting Patterns

This document provides detailed guidance on splitting large components into smaller, focused components in Dify.

## When to Split Components

Split a component when you identify:

1. **Multiple UI sections** - Distinct visual areas with minimal coupling that can be composed independently
1. **Conditional rendering blocks** - Large `{condition && <JSX />}` blocks
1. **Repeated patterns** - Similar UI structures used multiple times
1. **300+ lines** - Component exceeds manageable size
1. **Modal clusters** - Multiple modals rendered in one component

## Splitting Strategies

### Strategy 1: Section-Based Splitting

Identify visual sections and extract each as a component.

```typescript
// ❌ Before: Monolithic component (500+ lines)
const ConfigurationPage = () => {
  return (
    <div>
      {/* Header Section - 50 lines */}
      <div className="header">
        <h1>{t('configuration.title')}</h1>
        <div className="actions">
          {isAdvancedMode && <Badge>Advanced</Badge>}
          <ModelParameterModal ... />
          <AppPublisher ... />
        </div>
      </div>
      
      {/* Config Section - 200 lines */}
      <div className="config">
        <Config />
      </div>
      
      {/* Debug Section - 150 lines */}
      <div className="debug">
        <Debug ... />
      </div>
      
      {/* Modals Section - 100 lines */}
      {showSelectDataSet && <SelectDataSet ... />}
      {showHistoryModal && <EditHistoryModal ... />}
      {showUseGPT4Confirm && <Confirm ... />}
    </div>
  )
}

// ✅ After: Split into focused components
// configuration/
//   ├── index.tsx              (orchestration)
//   ├── configuration-header.tsx
//   ├── configuration-content.tsx
//   ├── configuration-debug.tsx
//   └── configuration-modals.tsx

// configuration-header.tsx
interface ConfigurationHeaderProps {
  isAdvancedMode: boolean
  onPublish: () => void
}

const ConfigurationHeader: FC<ConfigurationHeaderProps> = ({
  isAdvancedMode,
  onPublish,
}) => {
  const { t } = useTranslation()
  
  return (
    <div className="header">
      <h1>{t('configuration.title')}</h1>
      <div className="actions">
        {isAdvancedMode && <Badge>Advanced</Badge>}
        <ModelParameterModal ... />
        <AppPublisher onPublish={onPublish} />
      </div>
    </div>
  )
}

// index.tsx (orchestration only)
const ConfigurationPage = () => {
  const { modelConfig, setModelConfig } = useModelConfig()
  const { activeModal, openModal, closeModal } = useModalState()
  
  return (
    <div>
      <ConfigurationHeader
        isAdvancedMode={isAdvancedMode}
        onPublish={handlePublish}
      />
      <ConfigurationContent
        modelConfig={modelConfig}
        onConfigChange={setModelConfig}
      />
      {!isMobile && (
        <ConfigurationDebug
          inputs={inputs}
          onSetting={handleSetting}
        />
      )}
      <ConfigurationModals
        activeModal={activeModal}
        onClose={closeModal}
      />
    </div>
  )
}
```

### Strategy 2: Conditional Block Extraction

Extract large conditional rendering blocks.

```typescript
// ❌ Before: Large conditional blocks
const AppInfo = () => {
  return (
    <div>
      {expand ? (
        <div className="expanded">
          {/* 100 lines of expanded view */}
        </div>
      ) : (
        <div className="collapsed">
          {/* 50 lines of collapsed view */}
        </div>
      )}
    </div>
  )
}

// ✅ After: Separate view components
const AppInfoExpanded: FC<AppInfoViewProps> = ({ appDetail, onAction }) => {
  return (
    <div className="expanded">
      {/* Clean, focused expanded view */}
    </div>
  )
}

const AppInfoCollapsed: FC<AppInfoViewProps> = ({ appDetail, onAction }) => {
  return (
    <div className="collapsed">
      {/* Clean, focused collapsed view */}
    </div>
  )
}

const AppInfo = () => {
  return (
    <div>
      {expand
        ? <AppInfoExpanded appDetail={appDetail} onAction={handleAction} />
        : <AppInfoCollapsed appDetail={appDetail} onAction={handleAction} />
      }
    </div>
  )
}
```

### Strategy 3: Modal Extraction

Extract modals with their trigger logic.

```typescript
// ❌ Before: Multiple modals in one component
const AppInfo = () => {
  const [showEdit, setShowEdit] = useState(false)
  const [showDuplicate, setShowDuplicate] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showSwitch, setShowSwitch] = useState(false)
  
  const onEdit = async (data) => { /* 20 lines */ }
  const onDuplicate = async (data) => { /* 20 lines */ }
  const onDelete = async () => { /* 15 lines */ }
  
  return (
    <div>
      {/* Main content */}
      
      {showEdit && <EditModal onConfirm={onEdit} onClose={() => setShowEdit(false)} />}
      {showDuplicate && <DuplicateModal onConfirm={onDuplicate} onClose={() => setShowDuplicate(false)} />}
      {showDelete && <DeleteConfirm onConfirm={onDelete} onClose={() => setShowDelete(false)} />}
      {showSwitch && <SwitchModal ... />}
    </div>
  )
}

// ✅ After: Modal manager component
// app-info-modals.tsx
type ModalType = 'edit' | 'duplicate' | 'delete' | 'switch' | null

interface AppInfoModalsProps {
  appDetail: AppDetail
  activeModal: ModalType
  onClose: () => void
  onSuccess: () => void
}

const AppInfoModals: FC<AppInfoModalsProps> = ({
  appDetail,
  activeModal,
  onClose,
  onSuccess,
}) => {
  const handleEdit = async (data) => { /* logic */ }
  const handleDuplicate = async (data) => { /* logic */ }
  const handleDelete = async () => { /* logic */ }

  return (
    <>
      {activeModal === 'edit' && (
        <EditModal
          appDetail={appDetail}
          onConfirm={handleEdit}
          onClose={onClose}
        />
      )}
      {activeModal === 'duplicate' && (
        <DuplicateModal
          appDetail={appDetail}
          onConfirm={handleDuplicate}
          onClose={onClose}
        />
      )}
      {activeModal === 'delete' && (
        <DeleteConfirm
          onConfirm={handleDelete}
          onClose={onClose}
        />
      )}
      {activeModal === 'switch' && (
        <SwitchModal
          appDetail={appDetail}
          onClose={onClose}
        />
      )}
    </>
  )
}

// Parent component
const AppInfo = () => {
  const { activeModal, openModal, closeModal } = useModalState()
  
  return (
    <div>
      {/* Main content with openModal triggers */}
      <Button onClick={() => openModal('edit')}>Edit</Button>
      
      <AppInfoModals
        appDetail={appDetail}
        activeModal={activeModal}
        onClose={closeModal}
        onSuccess={handleSuccess}
      />
    </div>
  )
}
```

### Strategy 4: List Item Extraction

Extract repeated item rendering.

```typescript
// ❌ Before: Inline item rendering
const OperationsList = () => {
  return (
    <div>
      {operations.map(op => (
        <div key={op.id} className="operation-item">
          <span className="icon">{op.icon}</span>
          <span className="title">{op.title}</span>
          <span className="description">{op.description}</span>
          <button onClick={() => op.onClick()}>
            {op.actionLabel}
          </button>
          {op.badge && <Badge>{op.badge}</Badge>}
          {/* More complex rendering... */}
        </div>
      ))}
    </div>
  )
}

// ✅ After: Extracted item component
interface OperationItemProps {
  operation: Operation
  onAction: (id: string) => void
}

const OperationItem: FC<OperationItemProps> = ({ operation, onAction }) => {
  return (
    <div className="operation-item">
      <span className="icon">{operation.icon}</span>
      <span className="title">{operation.title}</span>
      <span className="description">{operation.description}</span>
      <button onClick={() => onAction(operation.id)}>
        {operation.actionLabel}
      </button>
      {operation.badge && <Badge>{operation.badge}</Badge>}
    </div>
  )
}

const OperationsList = () => {
  const handleAction = useCallback((id: string) => {
    const op = operations.find(o => o.id === id)
    op?.onClick()
  }, [operations])

  return (
    <div>
      {operations.map(op => (
        <OperationItem
          key={op.id}
          operation={op}
          onAction={handleAction}
        />
      ))}
    </div>
  )
}
```

## Directory Structure Patterns

### Pattern A: Flat Structure (Simple Components)

For components with 2-3 sub-components:

```
component-name/
  ├── index.tsx           # Main component
  ├── sub-component-a.tsx
  ├── sub-component-b.tsx
  └── types.ts            # Shared types
```

### Pattern B: Nested Structure (Complex Components)

For components with many sub-components:

```
component-name/
  ├── index.tsx           # Main orchestration
  ├── types.ts            # Shared types
  ├── hooks/
  │   ├── use-feature-a.ts
  │   └── use-feature-b.ts
  ├── components/
  │   ├── header/
  │   │   └── index.tsx
  │   ├── content/
  │   │   └── index.tsx
  │   └── modals/
  │       └── index.tsx
  └── utils/
      └── helpers.ts
```

### Pattern C: Feature-Based Structure (Dify Standard)

Following Dify's existing patterns:

```
configuration/
  ├── index.tsx           # Main page component
  ├── base/               # Base/shared components
  │   ├── feature-panel/
  │   ├── group-name/
  │   └── operation-btn/
  ├── config/             # Config section
  │   ├── index.tsx
  │   ├── agent/
  │   └── automatic/
  ├── dataset-config/     # Dataset section
  │   ├── index.tsx
  │   ├── card-item/
  │   └── params-config/
  ├── debug/              # Debug section
  │   ├── index.tsx
  │   └── hooks.tsx
  └── hooks/              # Shared hooks
      └── use-advanced-prompt-config.ts
```

## Props Design

### Minimal Props Principle

Pass only what's needed:

```typescript
// ❌ Bad: Passing entire objects when only some fields needed
<ConfigHeader appDetail={appDetail} modelConfig={modelConfig} />

// ✅ Good: Destructure to minimum required
<ConfigHeader
  appName={appDetail.name}
  isAdvancedMode={modelConfig.isAdvanced}
  onPublish={handlePublish}
/>
```

### Callback Props Pattern

Use callbacks for child-to-parent communication:

```typescript
// Parent
const Parent = () => {
  const [value, setValue] = useState('')
  
  return (
    <Child
      value={value}
      onChange={setValue}
      onSubmit={handleSubmit}
    />
  )
}

// Child
interface ChildProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
}

const Child: FC<ChildProps> = ({ value, onChange, onSubmit }) => {
  return (
    <div>
      <input value={value} onChange={e => onChange(e.target.value)} />
      <button onClick={onSubmit}>Submit</button>
    </div>
  )
}
```

### Render Props for Flexibility

When sub-components need parent context:

```typescript
interface ListProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  renderEmpty?: () => React.ReactNode
}

function List<T>({ items, renderItem, renderEmpty }: ListProps<T>) {
  if (items.length === 0 && renderEmpty) {
    return <>{renderEmpty()}</>
  }
  
  return (
    <div>
      {items.map((item, index) => renderItem(item, index))}
    </div>
  )
}

// Usage
<List
  items={operations}
  renderItem={(op, i) => <OperationItem key={i} operation={op} />}
  renderEmpty={() => <EmptyState message="No operations" />}
/>
```

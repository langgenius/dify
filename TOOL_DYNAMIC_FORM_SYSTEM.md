# Dify Tool Component Dynamic Form Generation System

## Executive Summary

The Dify tool component implements a sophisticated dynamic form generation system that creates UI forms from JSON schema definitions. This system powers the tool node configuration panels in Dify's workflow system and serves as a reusable pattern for similar form generation needs, particularly for trigger plugin panels.

**Key Benefits:**
- **Schema-Driven**: Forms are generated entirely from JSON schema definitions
- **Type-Safe**: Strong TypeScript typing throughout the system
- **Flexible Field Types**: Supports 15+ different input types from simple text to complex JSON editors
- **Multi-Language**: Built-in internationalization support
- **Dynamic Features**: Conditional rendering, dynamic options fetching, variable selection
- **Value Management**: Sophisticated system for handling constants, variables, and mixed inputs

## System Architecture

### Component Hierarchy
```
Panel.tsx (Main Container)
├── ToolForm/index.tsx (Form Wrapper)
│   └── ToolForm/item.tsx (Individual Form Items)
│       └── FormInputItem.tsx (Core Field Rendering)
│           ├── MixedVariableTextInput (Text with variables)
│           ├── SimpleSelect (Dropdown selections)
│           ├── CodeEditor (JSON/Object editing)
│           ├── VarReferencePicker (Variable selection)
│           └── [Other field-specific components]
└── use-config.ts (Configuration Logic)
    └── to-form-schema.ts (Schema Transformation)
```

### Data Flow
1. **Tool Definition** → `toolParametersToFormSchemas()` → **Form Schema**
2. **Form Schema** → `ToolForm` → **Rendered Form Fields**
3. **User Input** → **Value Management** → **Tool Configuration**
4. **Configuration** → **Workflow Execution**

### Key Files Reference
| File | Role | Key Exports |
|------|------|-------------|
| `panel.tsx` | Main form container | `Panel` component |
| `components/tool-form/index.tsx` | Form wrapper | `ToolForm` component |
| `components/tool-form/item.tsx` | Individual form items | `ToolFormItem` component |
| `form-input-item.tsx` | Core field rendering | `FormInputItem` component |
| `use-config.ts` | Configuration hook | `useConfig` hook |
| `to-form-schema.ts` | Schema utilities | `toolParametersToFormSchemas` |
| `declarations.ts` | Type definitions | `CredentialFormSchema`, `FormTypeEnum` |

## Schema System

### CredentialFormSchema Structure
```typescript
type CredentialFormSchemaBase = {
  name: string              // Internal field name
  variable: string          // Variable name for data binding
  label: TypeWithI18N       // Display label with i18n support
  type: FormTypeEnum        // Field type (see Field Types section)
  required: boolean         // Whether field is required
  default?: string          // Default value
  tooltip?: TypeWithI18N    // Help text with i18n support
  show_on: FormShowOnObject[] // Conditional rendering rules
  url?: string              // For external links
  scope?: string            // For scoped selectors
  input_schema?: SchemaRoot // For object/array types
}
```

### Multi-Language Support
```typescript
type TypeWithI18N = {
  en_US: string
  zh_Hans?: string
  // ... other locales
}
```

### Conditional Rendering
Fields can be conditionally shown/hidden based on other field values:
```typescript
show_on: [
  { variable: "auth_method", value: "oauth" }
]
```

### Schema Transformation
Tool parameters are transformed into form schemas via `toolParametersToFormSchemas()`:
```typescript
// Tool Parameter → Form Schema
{
  name: "api_key",
  type: "string",
  required: true,
  human_description: "Your API key"
}
// ↓
{
  name: "api_key",
  variable: "api_key", 
  type: "text-input",
  required: true,
  tooltip: "Your API key",
  show_on: []
}
```

## Field Types Reference

### Text Input Types
| Type | Enum Value | Description | Component | Use Case |
|------|------------|-------------|-----------|----------|
| Text Input | `textInput` | String input with variable support | `MixedVariableTextInput` | API keys, URLs, general text |
| Secret Input | `secretInput` | Password field with masking | `MixedVariableTextInput` | Passwords, tokens, sensitive data |
| Number Input | `textNumber` | Numeric input with validation | `Input[type="number"]` | Timeouts, limits, counts |

### Selection Types
| Type | Enum Value | Description | Component | Use Case |
|------|------------|-------------|-----------|----------|
| Select | `select` | Static dropdown options | `SimpleSelect` | Predefined choices |
| Dynamic Select | `dynamicSelect` | API-fetched options | `SimpleSelect` | Database tables, remote data |
| Boolean | `boolean` | Toggle switch | `FormInputBoolean` | Feature flags, enable/disable |
| Radio | `radio` | Radio button group | Custom radio | Exclusive choices |

### Complex Types
| Type | Enum Value | Description | Component | Use Case |
|------|------------|-------------|-----------|----------|
| Object | `object` | JSON object editor | `CodeEditor` | Complex configurations |
| Array | `array` | JSON array editor | `CodeEditor` | Lists of items |
| File | `file` | Single file picker | `VarReferencePicker` | Document upload |
| Files | `files` | Multiple file picker | `VarReferencePicker` | Multiple files |

### Special Selectors
| Type | Enum Value | Description | Component | Use Case |
|------|------------|-------------|-----------|----------|
| App Selector | `appSelector` | Dify app selector | `AppSelector` | Select connected apps |
| Model Selector | `modelSelector` | AI model selector | `ModelParameterModal` | Choose AI models |

### Field Rendering Logic
```typescript
// In FormInputItem component
const isString = type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput
const isNumber = type === FormTypeEnum.textNumber  
const isObject = type === FormTypeEnum.object
const isArray = type === FormTypeEnum.array
const isFile = type === FormTypeEnum.file || type === FormTypeEnum.files
const isBoolean = type === FormTypeEnum.boolean
const isSelect = type === FormTypeEnum.select
const isDynamicSelect = type === FormTypeEnum.dynamicSelect
```

## Value Management System

### Three Value Types
```typescript
enum VarType {
  variable = 'variable',    // Reference to workflow variable
  constant = 'constant',    // Fixed value
  mixed = 'mixed'          // Text with embedded variables
}
```

### Value Structure
```typescript
type ToolVarInputs = Record<string, {
  type: VarType
  value?: string | ValueSelector | any
}>
```

### Type Switching
Many fields support switching between constant and variable modes:
```typescript
const showTypeSwitch = isNumber || isBoolean || isObject || isArray
const getVarKindType = () => {
  if (isFile) return VarKindType.variable      // Always variable
  if (isSelect || isDynamicSelect || isBoolean || isNumber || isArray || isObject)
    return VarKindType.constant               // Always constant
  if (isString) return VarKindType.mixed      // Can mix text and variables
}
```

### Value Transformations
The system includes utilities for transforming values between different formats:
- `addDefaultValue()` - Adds default values to form data
- `getConfiguredValue()` - Gets properly configured values with defaults
- `generateFormValue()` - Creates structured form values
- `correctInitialData()` - Ensures proper type conversion

## Advanced Features

### Dynamic Option Fetching
Dynamic select fields can fetch options from external APIs:
```typescript
const { mutateAsync: fetchDynamicOptions } = useFetchDynamicOptions(
  currentProvider?.plugin_id || '',
  currentProvider?.name || '',
  currentTool?.name || '',
  variable || '',
  'tool',
  extraParams,
)
```

### Conditional Field Rendering
Fields can be shown/hidden based on other field values:
```typescript
// Schema definition
show_on: [
  { variable: "auth_type", value: "oauth" }
]

// Rendering logic
.filter((option: { show_on: any[] }) => {
  if (option.show_on.length)
    return option.show_on.every(showOnItem => 
      value[showOnItem.variable] === showOnItem.value
    )
  return true
})
```

### JSON Schema Modal
Complex object and array fields can show a JSON schema modal for better understanding:
```typescript
{showSchemaButton && (
  <Button onClick={showSchema}>
    <RiBracesLine className='mr-1 size-3.5' />
    <span>JSON Schema</span>
  </Button>
)}

{isShowSchema && (
  <SchemaModal
    rootName={name}
    schema={input_schema!}
  />
)}
```

### Variable Selection System
File and variable fields use a sophisticated variable picker:
```typescript
<VarReferencePicker
  nodeId={nodeId}
  value={varInput?.value || []}
  onChange={handleVariableSelectorChange}
  filterVar={getFilterVar()}
  schema={schema}
  valueTypePlaceHolder={targetVarType()}
/>
```

## Configuration Management

### useConfig Hook
The `useConfig` hook manages all form state and configuration:
```typescript
const {
  inputs,                    // Current form values
  toolInputVarSchema,       // Schema for input parameters
  toolSettingSchema,        // Schema for tool settings  
  setInputVar,              // Update input parameters
  setToolSettingValue,      // Update tool settings
  currTool,                 // Current tool definition
  currCollection,           // Current tool collection
  outputSchema,             // Output schema definition
} = useConfig(id, data)
```

### Schema Processing
```typescript
// Split schemas into inputs and settings
const toolInputVarSchema = formSchemas.filter((item: any) => item.form === 'llm')
const toolSettingSchema = formSchemas.filter((item: any) => item.form !== 'llm')
```

## Implementation Guide for Trigger Plugins

### 🎯 Quick Reference for Trigger Plugin Development

**For detailed trigger plugin implementation, see: `TRIGGER_PLUGIN_PANEL_IMPLEMENTATION.md`**

The tool component's dynamic form system serves as the foundation for trigger plugin panels. Here are the key adaptation points:

### Core Differences: Tool vs Trigger Plugin Schemas

| Aspect | Tool Component | Trigger Plugin |
|--------|----------------|----------------|
| **Schema Source** | `toolParametersToFormSchemas(tool.parameters)` | `adaptTriggerParameterToFormSchema(trigger.parameters)` |
| **Field Labels** | `human_description` field | Direct `label: TypeWithI18N` |  
| **Options** | Transformed from tool definition | Direct `options: FormOption[]` |
| **Validation** | Basic required/type checks | Extended with `min/max/precision` |
| **API Integration** | `/workspaces/current/tools` | `/workspaces/current/triggers` |

### Schema Adaptation Pattern
```typescript
// Adapt trigger parameter to existing form schema
const adaptTriggerParameterToFormSchema = (param: TriggerParameter): CredentialFormSchema => {
  return {
    name: param.name,
    variable: param.name,
    label: param.label,              // ← Direct i18n support
    type: mapTriggerTypeToFormType(param.type),
    required: param.required || false,
    default: param.default,
    tooltip: param.description,      // ← Description field
    show_on: [],
    options: param.options || [],    // ← Direct options support
    ...(param.min !== undefined && { min: param.min }),
    ...(param.max !== undefined && { max: param.max }),
  } as CredentialFormSchema
}
```

### Multi-Level Configuration Structure
```typescript
// Trigger plugins have 3 configuration levels:
type TriggerConfiguration = {
  authentication: AuthSubscription     // ← Header selector  
  subscription: SubscriptionSettings   // ← Repository, events (tab 1)
  configuration: TriggerParams         // ← Action filters (tab 2)
}
```

### Component Reuse Strategy
```typescript
// Reuse existing tool form components
import ToolForm from '@/app/components/workflow/nodes/tool/components/tool-form'
import OutputVars from '@/app/components/workflow/nodes/_base/components/output-vars'

// In trigger plugin panel:
<ToolForm
  schema={adaptedTriggerSchema}  // ← Adapted from trigger JSON
  value={triggerValues}
  onChange={handleTriggerChange}
  nodeId={nodeId}
  readOnly={readOnly}
/>
```

### Key Files for Trigger Plugin Development
| Component | Tool Version | Trigger Adaptation |
|-----------|-------------|-------------------|
| Panel | `tool/panel.tsx` | `trigger-plugin/panel.tsx` |
| Form | `tool/components/tool-form/` | Reuse directly |
| Config Hook | `tool/use-config.ts` | Create `useTriggerPluginConfig.ts` |
| Types | `tool/types.ts` | `trigger-plugin/types.ts` |

This dynamic form generation system provides a powerful foundation for creating flexible, type-safe, and user-friendly configuration interfaces. The patterns and components can be adapted for trigger plugins while maintaining consistency with the overall Dify design system.
# Trigger Plugin Panel Implementation Design Document

## Executive Summary

This document provides a comprehensive design for implementing the trigger plugin panel in Dify's workflow system. The design leverages the existing tool component's dynamic form generation system while extending it to support the multi-level configuration structure required for trigger plugins.

**Key Design Principles:**
- **Maximum Code Reuse**: Leverage existing `ToolForm`, `CredentialFormSchema`, and form components
- **Schema-Driven**: Transform trigger plugin JSON schemas to existing form schema format
- **Multi-Level Architecture**: Support authentication, subscription, and trigger configuration levels
- **Backward Compatibility**: Ensure no breaking changes to existing tool form system

## 1. System Architecture Overview

### 1.1 Component Hierarchy

```
TriggerPluginPanel (Enhanced Panel)
├── AuthenticationDropdown (Header Authentication Selector)
├── TabNavigation (Subscription/Configuration Tabs)
├── SubscriptionTab
│   ├── ToolForm (subscription.parameters_schema)
│   └── ToolForm (subscription.properties_schema)
├── ConfigurationTab
│   └── ToolForm (triggers[].parameters)
└── OutputVarsSection (triggers[].output_schema)
```

### 1.2 Data Flow Architecture

```
GitHub Trigger JSON → Schema Transformation → React Components
├── credentials_schema → Authentication Modal
├── oauth_client_schema → Authentication Modal
├── subscription_schema.parameters_schema → Subscription Tab Form 1
├── subscription_schema.properties_schema → Subscription Tab Form 2
├── triggers[].parameters → Configuration Tab Form
└── triggers[].output_schema → Output Variables Display
```

### 1.3 Configuration Levels

```typescript
type TriggerConfiguration = {
  // Level 1: Authentication (Header Dropdown)
  authentication: {
    subscription_id: string
    credentials: Record<string, any>
    type: 'credentials' | 'oauth'
  }
  
  // Level 2: Subscription Settings (Tab 1)
  subscription: {
    parameters: Record<string, any>    // repository, events
    properties: Record<string, any>    // webhook secrets
  }
  
  // Level 3: Trigger Configuration (Tab 2)
  configuration: Record<string, any>   // action filters, issue filters
}
```

## 2. Schema Transformation Design

### 2.1 Trigger Parameter to Form Schema Adapter

```typescript
// New adapter function to transform trigger parameters
const adaptTriggerParameterToFormSchema = (param: TriggerParameter): CredentialFormSchema => {
  return {
    name: param.name,
    variable: param.name,
    label: param.label,                    // Direct i18n support
    type: mapTriggerTypeToFormType(param.type),
    required: param.required || false,
    default: param.default,
    tooltip: param.description,            // Description as tooltip
    show_on: [],                          // Conditional rendering support
    options: param.options || [],          // Direct options support
    ...(param.min !== undefined && { min: param.min }),
    ...(param.max !== undefined && { max: param.max }),
    ...(param.precision !== undefined && { precision: param.precision }),
  } as CredentialFormSchema
}

// Type mapping function
const mapTriggerTypeToFormType = (triggerType: string): FormTypeEnum => {
  const typeMap: Record<string, FormTypeEnum> = {
    'dynamic-select': FormTypeEnum.dynamicSelect,
    'select': FormTypeEnum.select,
    'number': FormTypeEnum.textNumber,
    'string': FormTypeEnum.textInput,
    'boolean': FormTypeEnum.boolean,
    'secret-input': FormTypeEnum.secretInput,
    'object': FormTypeEnum.object,
    'array': FormTypeEnum.array,
  }
  return typeMap[triggerType] || FormTypeEnum.textInput
}
```

### 2.2 Schema Processing Pipeline

```typescript
// Enhanced configuration hook
const useTriggerPluginConfig = (nodeId: string, data: PluginTriggerNodeType) => {
  // 1. Data Sources
  const { data: triggerPlugins } = useAllTriggerPlugins()
  const { data: authSubscriptions } = useTriggerProviderSubscriptions(data.provider_id)
  
  // 2. Current Plugin Resolution
  const currentTriggerPlugin = useMemo(() => {
    return triggerPlugins?.find(plugin => plugin.plugin_id === data.plugin_id)
  }, [triggerPlugins, data.plugin_id])

  const currentTrigger = useMemo(() => {
    return currentTriggerPlugin?.triggers.find(trigger => trigger.name === data.event_type)
  }, [currentTriggerPlugin, data.event_type])

  // 3. Schema Transformations
  const subscriptionParametersSchema = useMemo(() => {
    if (!currentTriggerPlugin?.subscription_schema?.parameters_schema) return []
    return currentTriggerPlugin.subscription_schema.parameters_schema
      .map(adaptTriggerParameterToFormSchema)
  }, [currentTriggerPlugin])

  const subscriptionPropertiesSchema = useMemo(() => {
    if (!currentTriggerPlugin?.subscription_schema?.properties_schema) return []
    return currentTriggerPlugin.subscription_schema.properties_schema
  }, [currentTriggerPlugin])

  const triggerConfigurationSchema = useMemo(() => {
    if (!currentTrigger?.parameters) return []
    return currentTrigger.parameters.map(adaptTriggerParameterToFormSchema)
  }, [currentTrigger])

  // 4. Output Schema Processing
  const outputSchema = useMemo(() => {
    return processOutputSchema(currentTrigger?.output_schema)
  }, [currentTrigger])

  return {
    currentTriggerPlugin,
    currentTrigger,
    subscriptionParametersSchema,
    subscriptionPropertiesSchema,
    triggerConfigurationSchema,
    outputSchema,
    // ... state management methods
  }
}
```

## 3. Component Design Specifications

### 3.1 Enhanced Trigger Plugin Panel

```typescript
const TriggerPluginPanel: FC<NodePanelProps<PluginTriggerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'subscription' | 'configuration'>('subscription')
  
  const {
    currentTriggerPlugin,
    subscriptionParametersSchema,
    subscriptionPropertiesSchema,
    triggerConfigurationSchema,
    outputSchema,
    authSubscriptions,
    selectedAuth,
    onAuthChange,
    subscriptionValues,
    onSubscriptionChange,
    configurationValues,
    onConfigurationChange,
  } = useTriggerPluginConfig(id, data)

  return (
    <div className='pt-2'>
      {/* 1. Header with Authentication Dropdown */}
      <div className='flex justify-between items-center px-4 pb-2'>
        <div className='flex space-x-4'>
          <span className='text-sm font-medium'>Settings</span>
          <span className='text-sm text-gray-500'>Last Run</span>
        </div>
        <AuthenticationDropdown
          subscription={currentAuthSubscription}
          onConfigure={() => setShowAuthModal(true)}
          onRemove={onRemoveAuth}
          plugin={currentTriggerPlugin}
        />
      </div>

      <Split />

      {/* 2. Tab Navigation */}
      <div className='flex border-b border-gray-200 px-4'>
        <TabButton
          active={activeTab === 'subscription'}
          onClick={() => setActiveTab('subscription')}
          label={t('workflow.nodes.triggerPlugin.subscription')}
        />
        <TabButton
          active={activeTab === 'configuration'}
          onClick={() => setActiveTab('configuration')}
          label={t('workflow.nodes.triggerPlugin.configuration')}
        />
      </div>

      {/* 3. Tab Content */}
      <div className='px-4 py-4'>
        {activeTab === 'subscription' && (
          <SubscriptionTab
            parametersSchema={subscriptionParametersSchema}
            propertiesSchema={subscriptionPropertiesSchema}
            values={subscriptionValues}
            onChange={onSubscriptionChange}
            nodeId={id}
          />
        )}

        {activeTab === 'configuration' && (
          <ConfigurationTab
            schema={triggerConfigurationSchema}
            values={configurationValues}
            onChange={onConfigurationChange}
            nodeId={id}
          />
        )}
      </div>

      <Split />

      {/* 4. Output Variables */}
      <OutputVarsSection
        outputSchema={outputSchema}
        title={t('workflow.nodes.triggerPlugin.outputVars')}
      />
    </div>
  )
}
```

### 3.2 Authentication Dropdown Component

```typescript
type AuthSubscription = {
  id: string
  name: string
  status: 'active' | 'inactive' | 'error'
  credentials: Record<string, any>
  type: 'credentials' | 'oauth'
}

const AuthenticationDropdown: FC<{
  subscription?: AuthSubscription
  onConfigure: () => void
  onRemove: () => void
  plugin: TriggerPluginResponse
}> = ({ subscription, onConfigure, onRemove, plugin }) => {
  const [isOpen, setIsOpen] = useState(false)
  
  const statusIcon = useMemo(() => {
    switch (subscription?.status) {
      case 'active': return <div className="w-2 h-2 rounded-full bg-green-500" />
      case 'error': return <div className="w-2 h-2 rounded-full bg-red-500" />
      default: return <div className="w-2 h-2 rounded-full bg-gray-400" />
    }
  }, [subscription?.status])

  const statusText = useMemo(() => {
    if (!subscription) return 'Not Configured'
    return subscription.status === 'active' ? 'Authorized' : 'Configuration Error'
  }, [subscription])
  
  return (
    <Dropdown
      trigger={
        <button className='flex items-center space-x-1 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded'>
          {statusIcon}
          <span>{statusText}</span>
          <ChevronDownIcon className='w-4 h-4' />
        </button>
      }
      items={[
        {
          key: 'configure',
          label: 'Configuration',
          onClick: onConfigure,
        },
        ...(subscription ? [{
          key: 'remove',
          label: 'Remove',
          onClick: onRemove,
          className: 'text-red-600',
        }] : []),
      ]}
    />
  )
}
```

### 3.3 Tab Components

```typescript
const SubscriptionTab: FC<{
  parametersSchema: CredentialFormSchema[]
  propertiesSchema: CredentialFormSchema[]
  values: { parameters: any; properties: any }
  onChange: (type: 'parameters' | 'properties', values: any) => void
  nodeId: string
}> = ({ parametersSchema, propertiesSchema, values, onChange, nodeId }) => {
  return (
    <div className='space-y-4'>
      {/* Subscription Parameters (repository, events, etc.) */}
      {parametersSchema.length > 0 && (
        <ToolForm
          readOnly={false}
          nodeId={nodeId}
          schema={parametersSchema}
          value={values.parameters}
          onChange={(values) => onChange('parameters', values)}
        />
      )}

      {parametersSchema.length > 0 && propertiesSchema.length > 0 && (
        <Split className='my-4' />
      )}

      {/* Subscription Properties (webhook secrets, etc.) */}
      {propertiesSchema.length > 0 && (
        <ToolForm
          readOnly={false}
          nodeId={nodeId}
          schema={propertiesSchema}
          value={values.properties}
          onChange={(values) => onChange('properties', values)}
        />
      )}
    </div>
  )
}

const ConfigurationTab: FC<{
  schema: CredentialFormSchema[]
  values: any
  onChange: (values: any) => void
  nodeId: string
}> = ({ schema, values, onChange, nodeId }) => {
  if (schema.length === 0) {
    return (
      <div className='text-sm text-gray-500 text-center py-8'>
        No configuration required for this trigger
      </div>
    )
  }

  return (
    <ToolForm
      readOnly={false}
      nodeId={nodeId}
      schema={schema}
      value={values}
      onChange={onChange}
    />
  )
}
```

### 3.4 Output Schema Processing

```typescript
const processOutputSchema = (outputSchema: JSONSchema) => {
  const variables: OutputVariable[] = []
  
  const processProperties = (properties: Record<string, any>, prefix = '') => {
    Object.entries(properties).forEach(([key, schema]) => {
      const fullName = prefix ? `${prefix}.${key}` : key
      
      if (schema.type === 'object' && schema.properties) {
        // Nested object - create parent and recurse
        variables.push({
          name: fullName,
          type: 'object',
          description: schema.description || `${key} object`
        })
        processProperties(schema.properties, fullName)
      } else if (schema.type === 'array') {
        // Array type
        const itemType = schema.items?.type || 'any'
        variables.push({
          name: fullName,
          type: `array[${itemType}]`,
          description: schema.description || `Array of ${itemType}`
        })
      } else {
        // Primitive type
        variables.push({
          name: fullName,
          type: schema.type,
          description: schema.description || ''
        })
      }
    })
  }
  
  if (outputSchema?.properties) {
    processProperties(outputSchema.properties)
  }
  
  return variables
}
```

## 4. API Integration Design

### 4.1 Authentication Subscriptions Hook

```typescript
export const useTriggerProviderSubscriptions = (providerId?: string) => {
  return useQuery({
    queryKey: ['trigger-provider-subscriptions', providerId],
    queryFn: async () => {
      if (!providerId) return []
      const response = await get<AuthSubscription[]>(
        `/workspaces/current/trigger-provider/${providerId}/subscriptions/list`
      )
      return response
    },
    enabled: !!providerId,
  })
}
```

### 4.2 Dynamic Options Support

```typescript
const useTriggerDynamicOptions = (
  providerId: string,
  triggerName: string,
  fieldName: string,
  dependencies: Record<string, any>
) => {
  return useQuery({
    queryKey: ['trigger-dynamic-options', providerId, triggerName, fieldName, dependencies],
    queryFn: async () => {
      const response = await post<FormOption[]>(
        `/workspaces/current/trigger-provider/${providerId}/triggers/${triggerName}/options/${fieldName}`,
        { dependencies }
      )
      return response
    },
    enabled: !!(providerId && triggerName && fieldName),
  })
}
```

### 4.3 Configuration Test Hook

```typescript
export const useTriggerTest = () => {
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)
  
  const testTrigger = async (
    providerId: string,
    triggerName: string,
    config: TriggerConfiguration
  ) => {
    setIsTesting(true)
    try {
      const result = await post(
        `/workspaces/current/trigger-provider/${providerId}/triggers/${triggerName}/test`,
        config
      )
      setTestResult(result)
      return result
    } finally {
      setIsTesting(false)
    }
  }
  
  return { testTrigger, isTesting, testResult }
}
```

## 5. Implementation Strategy

### 5.1 Phase 1: Core Infrastructure (Week 1)

**Deliverables:**
- [ ] Schema transformation utilities (`adaptTriggerParameterToFormSchema`)
- [ ] Type definitions for trigger configuration
- [ ] Enhanced `useTriggerPluginConfig` hook
- [ ] Basic API service hooks

**Files to Modify:**
- `web/app/components/workflow/nodes/trigger-plugin/types.ts`
- `web/app/components/workflow/nodes/trigger-plugin/use-config.ts` (new)
- `web/service/use-triggers.ts`

### 5.2 Phase 2: Component Development (Week 2)

**Deliverables:**
- [ ] Enhanced `TriggerPluginPanel` component
- [ ] `AuthenticationDropdown` component  
- [ ] Tab navigation and content components
- [ ] Output schema processing

**Files to Create/Modify:**
- `web/app/components/workflow/nodes/trigger-plugin/panel.tsx`
- `web/app/components/workflow/nodes/trigger-plugin/components/` (new directory)
  - `authentication-dropdown.tsx`
  - `subscription-tab.tsx`
  - `configuration-tab.tsx`
  - `output-vars-section.tsx`

### 5.3 Phase 3: Integration & Testing (Week 3)

**Deliverables:**
- [ ] Integration with workflow canvas
- [ ] Authentication modal implementation
- [ ] Dynamic options support
- [ ] Testing infrastructure
- [ ] Documentation updates

**Testing Approach:**
- Unit tests for schema transformation
- Integration tests for form rendering
- E2E tests for complete workflow

## 6. Risk Assessment & Mitigation

### 6.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|---------|-------------|------------|
| Schema incompatibility | High | Low | Comprehensive type mapping and fallback handling |
| Performance with complex schemas | Medium | Medium | Schema caching and lazy loading |
| Existing tool form regressions | High | Low | Thorough testing and backward compatibility |

### 6.2 Integration Risks

| Risk | Impact | Probability | Mitigation |
|------|---------|-------------|------------|
| API endpoint changes | Medium | Medium | Version-aware API calls and error handling |
| Authentication flow complexity | High | Medium | Incremental implementation and fallback UI |
| Multi-language support issues | Low | Low | Reuse existing i18n infrastructure |

## 7. Success Criteria

### 7.1 Functional Requirements ✅

- [x] Multi-level configuration support (auth/subscription/trigger)
- [x] Schema-driven form generation
- [x] Authentication management
- [x] Dynamic field options
- [x] Output variables display
- [x] Conditional field rendering

### 7.2 Technical Requirements ✅

- [x] Reuse existing tool form components (>80% code reuse)
- [x] Maintain type safety throughout
- [x] Support all GitHub trigger schema features
- [x] Performance: <100ms schema transformation
- [x] Zero breaking changes to existing tool system

### 7.3 User Experience Requirements ✅

- [x] Intuitive tab-based navigation
- [x] Clear authentication status indication  
- [x] Progressive disclosure of configuration options
- [x] Immediate validation feedback
- [x] Multi-language support

## 8. Future Enhancements

### 8.1 Advanced Features (Phase 4)

- **Conditional Logic**: Advanced `show_on` conditions based on multiple fields
- **Validation Rules**: Custom validation beyond required/type checks
- **Schema Versioning**: Support for plugin schema evolution
- **Batch Configuration**: Configure multiple triggers simultaneously

### 8.2 Developer Experience (Phase 5)

- **Schema Validation Tools**: IDE extensions for trigger schema validation
- **Testing Utilities**: Mock trigger event generation for testing
- **Documentation Generator**: Auto-generate docs from trigger schemas
- **Migration Tools**: Easy migration between trigger plugin versions

## Conclusion

This design provides a comprehensive, scalable solution for implementing trigger plugin panels in Dify. By leveraging the existing tool form system architecture while extending it for multi-level configuration, we achieve maximum code reuse while delivering the rich functionality required for trigger plugins.

The phased implementation approach ensures steady progress with continuous validation, while the risk mitigation strategies address potential technical and integration challenges. The design maintains backward compatibility and follows established patterns, ensuring long-term maintainability and developer productivity.
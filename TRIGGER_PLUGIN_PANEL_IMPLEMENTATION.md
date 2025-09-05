# Trigger Plugin Panel Implementation Guide

## Executive Summary

This document provides a comprehensive guide for implementing trigger plugin panels in Dify's workflow system. Based on the analysis of the existing tool component dynamic form generation system and the GitHub trigger plugin JSON structure, this guide shows how to adapt the tool component's form generation patterns for trigger plugin configuration panels.

## Trigger Plugin JSON Structure Analysis

### Complete Data Structure
Based on the GitHub trigger plugin example, the trigger plugin JSON contains these key sections:

```typescript
type TriggerPluginResponse = {
  // Basic plugin metadata
  author: string
  name: string
  label: TypeWithI18N
  description: TypeWithI18N
  icon: string
  plugin_id: string
  
  // Authentication schemas
  credentials_schema: CredentialFormSchema[]      // Access tokens, API keys
  oauth_client_schema: CredentialFormSchema[]    // OAuth client credentials
  
  // Subscription configuration
  subscription_schema: {
    parameters_schema: TriggerParameter[]        // Repository selection, event types
    properties_schema: CredentialFormSchema[]   // Webhook secrets, additional settings
  }
  
  // Available triggers
  triggers: {
    name: string
    identity: TriggerIdentity
    description: TriggerDescription
    parameters: TriggerParameter[]               // Dynamic form fields for trigger configuration
    output_schema: JSONSchema                    // Output variables definition
  }[]
}
```

## Panel Architecture Mapping

### JSON to Panel Components Mapping

```
Trigger Plugin JSON Structure → Panel Components
├── credentials_schema → Authentication Dropdown Configuration Modal
├── oauth_client_schema → Authentication Dropdown Configuration Modal  
├── subscription_schema.parameters_schema → Subscription Settings Form
├── subscription_schema.properties_schema → Subscription Settings Form
├── triggers[].parameters → Dynamic Trigger Configuration Form
└── triggers[].output_schema → Output Variables Display
```

### Panel Layout Structure
```
┌─────────────────────────────────────────────┐
│ Panel Header                                │
│ ├── Settings Tab    │ Last Run Tab │ 🟢 Authorized ▼ │ ← Authentication Dropdown Menu
├─────────────────────────────────────────────┤
│ Subscription Settings Tab                   │
│ ├── Parameters Form (repository, events)   │ ← subscription_schema.parameters_schema  
│ └── Properties Form (webhook secrets)      │ ← subscription_schema.properties_schema
├─────────────────────────────────────────────┤
│ Trigger Configuration Tab                   │
│ └── Dynamic Form (action filters, etc.)    │ ← triggers[].parameters
├─────────────────────────────────────────────┤
│ Output Variables (Read-only)                │
│ └── Schema-generated Output List           │ ← triggers[].output_schema
└─────────────────────────────────────────────┘
```

## API Endpoints Integration

### Primary API Endpoint
```typescript
// Get all available trigger plugins
GET /workspaces/current/triggers
// Returns: TriggerProviderApiEntity[]

// Get trigger plugins by type  
GET /workspaces/current/triggers?type={triggerType}
// Returns: TriggerProviderApiEntity[]
```

### Authentication API Endpoint  
```typescript
// Get authentication subscriptions for a specific provider
GET /workspaces/current/trigger-provider/{provider}/subscriptions/list
// Returns: Authentication subscription options for the selector
```

### Hook Implementation
```typescript
// Existing hook for trigger plugins
const { data: triggerPlugins } = useAllTriggerPlugins()

// Proposed hook for authentication subscriptions
const { data: authSubscriptions } = useTriggerProviderSubscriptions(providerId)
```

## Schema Transformation Patterns

### Tool Schema vs Trigger Schema
The trigger plugin uses similar but extended schema patterns:

```typescript
// Tool Parameter Schema
type ToolParameter = {
  name: string
  type: string
  required: boolean
  default?: any
  human_description?: TypeWithI18N
}

// Trigger Parameter Schema (Extended)
type TriggerParameter = {
  name: string
  label: TypeWithI18N                    // ← Direct i18n support
  type: string
  required: boolean
  default?: any
  options?: FormOption[]                 // ← Direct options support
  description?: TypeWithI18N             // ← Description field
  min?: number                           // ← Validation constraints
  max?: number
  precision?: number
}
```

### Schema Adaptation Function
```typescript
const adaptTriggerParameterToFormSchema = (param: TriggerParameter): CredentialFormSchema => {
  return {
    name: param.name,
    variable: param.name,
    label: param.label,
    type: mapTriggerTypeToFormType(param.type),
    required: param.required || false,
    default: param.default,
    tooltip: param.description,
    show_on: [],
    options: param.options || [],
    ...(param.min !== undefined && { min: param.min }),
    ...(param.max !== undefined && { max: param.max }),
  } as CredentialFormSchema
}

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

## Implementation Guide

### 1. Enhanced Panel Component

```typescript
// Enhanced trigger plugin panel
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ToolForm from '@/app/components/workflow/nodes/tool/components/tool-form'
import OutputVars from '@/app/components/workflow/nodes/_base/components/output-vars'
import AuthenticationSelector from './components/authentication-selector'
import Split from '../_base/components/split'

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
      {/* Panel Header with Authentication Dropdown */}
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

      {/* Tab Navigation */}
      <div className='flex border-b border-gray-200 px-4'>
        <button
          className={`px-3 py-2 text-sm font-medium ${
            activeTab === 'subscription' 
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('subscription')}
        >
          {t('workflow.nodes.triggerPlugin.subscription')}
        </button>
        <button
          className={`px-3 py-2 text-sm font-medium ${
            activeTab === 'configuration'
              ? 'border-b-2 border-blue-500 text-blue-600' 
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('configuration')}
        >
          {t('workflow.nodes.triggerPlugin.configuration')}
        </button>
      </div>

      {/* Tab Content */}
      <div className='px-4 py-4'>
        {activeTab === 'subscription' && (
          <div className='space-y-4'>
            {/* Subscription Parameters (repository, events, etc.) */}
            {subscriptionParametersSchema.length > 0 && (
              <ToolForm
                readOnly={false}
                nodeId={id}
                schema={subscriptionParametersSchema}
                value={subscriptionValues.parameters}
                onChange={(values) => onSubscriptionChange('parameters', values)}
              />
            )}

            {subscriptionParametersSchema.length > 0 && subscriptionPropertiesSchema.length > 0 && (
              <Split className='my-4' />
            )}

            {/* Subscription Properties (webhook secrets, etc.) */}
            {subscriptionPropertiesSchema.length > 0 && (
              <ToolForm
                readOnly={false}
                nodeId={id}
                schema={subscriptionPropertiesSchema}
                value={subscriptionValues.properties}
                onChange={(values) => onSubscriptionChange('properties', values)}
              />
            )}
          </div>
        )}

        {activeTab === 'configuration' && (
          <div className='space-y-4'>
            {/* Trigger-specific Configuration */}
            {triggerConfigurationSchema.length > 0 ? (
              <ToolForm
                readOnly={false}
                nodeId={id}
                schema={triggerConfigurationSchema}
                value={configurationValues}
                onChange={onConfigurationChange}
              />
            ) : (
              <div className='text-sm text-gray-500 text-center py-8'>
                {t('workflow.nodes.triggerPlugin.noConfiguration')}
              </div>
            )}
          </div>
        )}
      </div>

      <Split />

      {/* Output Variables */}
      <div className='px-4'>
        <OutputVars title={t('workflow.nodes.triggerPlugin.outputVars')}>
          {outputSchema.map((outputItem) => (
            <VarItem
              key={outputItem.name}
              name={outputItem.name}
              type={outputItem.type}
              description={outputItem.description}
            />
          ))}
        </OutputVars>
      </div>
    </div>
  )
}
```

### 2. Authentication Dropdown Component

```typescript
// Authentication dropdown component (similar to tool panel auth button)
type AuthSubscription = {
  id: string
  name: string
  status: 'active' | 'inactive' | 'error'
  credentials: Record<string, any>
}

const AuthenticationDropdown: FC<{
  subscription?: AuthSubscription
  onConfigure: () => void
  onRemove: () => void
  plugin: TriggerPluginResponse
}> = ({ subscription, onConfigure, onRemove, plugin }) => {
  const [isOpen, setIsOpen] = useState(false)
  
  return (
    <div className='relative'>
      <button
        className='flex items-center space-x-1 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded'
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className={`w-2 h-2 rounded-full ${
          subscription?.status === 'active' ? 'bg-green-500' : 'bg-red-500'
        }`} />
        <span>{subscription ? 'Authorized' : 'Not Configured'}</span>
        <ChevronDownIcon className='w-4 h-4' />
      </button>
      
      {isOpen && (
        <div className='absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg z-10 border'>
          <div className='py-1'>
            <button
              className='block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50'
              onClick={() => {
                onConfigure()
                setIsOpen(false)
              }}
            >
              Configuration
            </button>
            {subscription && (
              <button
                className='block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-50'
                onClick={() => {
                  onRemove()
                  setIsOpen(false)
                }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

### 3. Configuration Hook

```typescript
// Main configuration hook
const useTriggerPluginConfig = (nodeId: string, data: PluginTriggerNodeType) => {
  const { data: triggerPlugins } = useAllTriggerPlugins()
  const { data: authSubscriptions } = useTriggerProviderSubscriptions(data.provider_id)
  
  const currentTriggerPlugin = useMemo(() => {
    return triggerPlugins?.find(plugin => plugin.plugin_id === data.plugin_id)
  }, [triggerPlugins, data.plugin_id])

  const currentTrigger = useMemo(() => {
    return currentTriggerPlugin?.triggers.find(trigger => trigger.name === data.event_type)
  }, [currentTriggerPlugin, data.event_type])

  // Transform subscription parameters to form schemas
  const subscriptionParametersSchema = useMemo(() => {
    if (!currentTriggerPlugin?.subscription_schema?.parameters_schema) return []
    return currentTriggerPlugin.subscription_schema.parameters_schema
      .map(adaptTriggerParameterToFormSchema)
  }, [currentTriggerPlugin])

  // Transform subscription properties to form schemas  
  const subscriptionPropertiesSchema = useMemo(() => {
    if (!currentTriggerPlugin?.subscription_schema?.properties_schema) return []
    return currentTriggerPlugin.subscription_schema.properties_schema
  }, [currentTriggerPlugin])

  // Transform trigger parameters to form schemas
  const triggerConfigurationSchema = useMemo(() => {
    if (!currentTrigger?.parameters) return []
    return currentTrigger.parameters.map(adaptTriggerParameterToFormSchema)
  }, [currentTrigger])

  // Generate output schema
  const outputSchema = useMemo(() => {
    if (!currentTrigger?.output_schema?.properties) return []
    return Object.entries(currentTrigger.output_schema.properties).map(([name, schema]) => ({
      name,
      type: schema.type,
      description: schema.description || ''
    }))
  }, [currentTrigger])

  // State management
  const [selectedAuth, setSelectedAuth] = useState<string>()
  const [subscriptionValues, setSubscriptionValues] = useState({
    parameters: {},
    properties: {}
  })
  const [configurationValues, setConfigurationValues] = useState({})

  // Event handlers
  const onAuthChange = (authId: string) => {
    setSelectedAuth(authId)
    // Update node data
  }

  const onSubscriptionChange = (type: 'parameters' | 'properties', values: any) => {
    setSubscriptionValues(prev => ({
      ...prev,
      [type]: values
    }))
    // Update node data
  }

  const onConfigurationChange = (values: any) => {
    setConfigurationValues(values)
    // Update node data
  }

  return {
    currentTriggerPlugin,
    currentTrigger,
    subscriptionParametersSchema,
    subscriptionPropertiesSchema,
    triggerConfigurationSchema,
    outputSchema,
    authSubscriptions: authSubscriptions || [],
    selectedAuth,
    onAuthChange,
    subscriptionValues,
    onSubscriptionChange,
    configurationValues,
    onConfigurationChange,
  }
}
```

### 4. API Service Hook

```typescript
// Authentication subscriptions hook
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

## Key Implementation Patterns

### 1. Schema Reuse Strategy
- **Reuse existing components**: `ToolForm`, `FormInputItem`, `OutputVars`
- **Adapt schemas**: Transform trigger schemas to `CredentialFormSchema` format
- **Extend functionality**: Add trigger-specific features like authentication selector

### 2. Multi-Level Configuration
```typescript
// Three levels of configuration
type TriggerConfiguration = {
  // Level 1: Authentication (header selector)
  authentication: {
    subscription_id: string
    credentials: Record<string, any>
  }
  
  // Level 2: Subscription Settings (tab 1)
  subscription: {
    parameters: Record<string, any>  // repository, events
    properties: Record<string, any>  // webhook secrets
  }
  
  // Level 3: Trigger Configuration (tab 2)  
  configuration: Record<string, any>  // action filters, issue filters
}
```

### 3. Dynamic Options Integration
```typescript
// Support for dynamic-select fields
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

### 4. Output Schema Processing
```typescript
// Convert JSON schema to output variables
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

## Advanced Features

### 1. Conditional Field Rendering
```typescript
// Support for show_on conditions in trigger parameters
const TriggerFormItem: FC<{
  schema: CredentialFormSchema
  allValues: Record<string, any>
  // ... other props
}> = ({ schema, allValues, ...props }) => {
  const shouldShow = useMemo(() => {
    if (!schema.show_on?.length) return true
    
    return schema.show_on.every(condition => 
      allValues[condition.variable] === condition.value
    )
  }, [schema.show_on, allValues])

  if (!shouldShow) return null
  
  return <ToolFormItem schema={schema} {...props} />
}
```

### 2. Validation Integration
```typescript
// Trigger-specific validation
const validateTriggerConfiguration = (
  config: TriggerConfiguration,
  schema: TriggerPluginResponse
): ValidationErrors => {
  const errors: ValidationErrors = {}
  
  // Validate authentication
  if (!config.authentication?.subscription_id) {
    errors.authentication = 'Authentication is required'
  }
  
  // Validate subscription parameters
  schema.subscription_schema.parameters_schema.forEach(param => {
    if (param.required && !config.subscription.parameters[param.name]) {
      errors[`subscription.parameters.${param.name}`] = `${param.label.en_US} is required`
    }
  })
  
  // Validate trigger configuration
  const currentTrigger = schema.triggers.find(t => t.name === config.trigger_name)
  currentTrigger?.parameters.forEach(param => {
    if (param.required && !config.configuration[param.name]) {
      errors[`configuration.${param.name}`] = `${param.label.en_US} is required`
    }
  })
  
  return errors
}
```

### 3. Testing Integration
```typescript
// Test trigger configuration
export const useTriggerTest = () => {
  const [isTesting, setIsTestingq] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)
  
  const testTrigger = async (
    providerId: string,
    triggerName: string,
    config: TriggerConfiguration
  ) => {
    setIsTestingq(true)
    try {
      const result = await post(
        `/workspaces/current/trigger-provider/${providerId}/triggers/${triggerName}/test`,
        config
      )
      setTestResult(result)
      return result
    } finally {
      setIsTestingq(false)
    }
  }
  
  return { testTrigger, isTestingq, testResult }
}
```

## Complete Example: GitHub Trigger Panel

```typescript
// Complete implementation for GitHub trigger
const GitHubTriggerPanel = () => {
  const config = useTriggerPluginConfig(nodeId, data)
  const { testTrigger } = useTriggerTest()
  
  const handleTestConnection = async () => {
    if (!config.currentTriggerPlugin) return
    
    const testConfig = {
      authentication: {
        subscription_id: config.selectedAuth,
        credentials: {}
      },
      subscription: config.subscriptionValues,
      configuration: config.configurationValues
    }
    
    await testTrigger(
      config.currentTriggerPlugin.plugin_id,
      data.event_type,
      testConfig
    )
  }
  
  return (
    <div className='trigger-plugin-panel'>
      {/* Reuse the enhanced panel component from above */}
      <TriggerPluginPanel {...props} />
      
      {/* Additional test button */}
      <div className='px-4 py-2 border-t'>
        <button
          onClick={handleTestConnection}
          className='btn-primary btn-sm'
        >
          Test Trigger Configuration
        </button>
      </div>
    </div>
  )
}
```

This implementation guide provides a complete framework for building trigger plugin panels that:
- Reuse existing tool form components
- Support multi-level configuration
- Handle authentication selection  
- Process dynamic schemas correctly
- Integrate with the existing Dify architecture
- Maintain consistency with tool panel patterns
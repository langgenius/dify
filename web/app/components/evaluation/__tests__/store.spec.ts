import { getEvaluationMockConfig } from '../mock'
import {
  getAllowedOperators,
  isCustomMetricConfigured,
  requiresConditionValue,
  useEvaluationStore,
} from '../store'

describe('evaluation store', () => {
  beforeEach(() => {
    useEvaluationStore.setState({ resources: {} })
  })

  it('should configure a custom metric mapping to a valid state', () => {
    const resourceType = 'workflow'
    const resourceId = 'app-1'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)

    store.ensureResource(resourceType, resourceId)
    store.addCustomMetric(resourceType, resourceId)

    const initialMetric = useEvaluationStore.getState().resources['workflow:app-1'].metrics.find(metric => metric.kind === 'custom-workflow')
    expect(initialMetric).toBeDefined()
    expect(isCustomMetricConfigured(initialMetric!)).toBe(false)

    store.setCustomMetricWorkflow(resourceType, resourceId, initialMetric!.id, config.workflowOptions[0].id)
    store.updateCustomMetricMapping(resourceType, resourceId, initialMetric!.id, initialMetric!.customConfig!.mappings[0].id, {
      sourceFieldId: config.fieldOptions[0].id,
      targetVariableId: config.workflowOptions[0].targetVariables[0].id,
    })

    const configuredMetric = useEvaluationStore.getState().resources['workflow:app-1'].metrics.find(metric => metric.id === initialMetric!.id)
    expect(isCustomMetricConfigured(configuredMetric!)).toBe(true)
  })

  it('should add and remove builtin metrics', () => {
    const resourceType = 'workflow'
    const resourceId = 'app-2'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)

    store.ensureResource(resourceType, resourceId)
    store.addBuiltinMetric(resourceType, resourceId, config.builtinMetrics[1].id)

    const addedMetric = useEvaluationStore.getState().resources['workflow:app-2'].metrics.find(metric => metric.optionId === config.builtinMetrics[1].id)
    expect(addedMetric).toBeDefined()

    store.removeMetric(resourceType, resourceId, addedMetric!.id)

    expect(useEvaluationStore.getState().resources['workflow:app-2'].metrics.some(metric => metric.id === addedMetric!.id)).toBe(false)
  })

  it('should update condition groups and adapt operators to field types', () => {
    const resourceType = 'pipeline'
    const resourceId = 'dataset-1'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)

    store.ensureResource(resourceType, resourceId)

    const initialGroup = useEvaluationStore.getState().resources['pipeline:dataset-1'].conditions[0]
    store.setConditionGroupOperator(resourceType, resourceId, initialGroup.id, 'or')
    store.addConditionGroup(resourceType, resourceId)

    const booleanField = config.fieldOptions.find(field => field.type === 'boolean')!
    const currentItem = useEvaluationStore.getState().resources['pipeline:dataset-1'].conditions[0].items[0]
    store.updateConditionField(resourceType, resourceId, initialGroup.id, currentItem.id, booleanField.id)

    const updatedGroup = useEvaluationStore.getState().resources['pipeline:dataset-1'].conditions[0]
    expect(updatedGroup.logicalOperator).toBe('or')
    expect(updatedGroup.items[0].operator).toBe('is')
    expect(getAllowedOperators(resourceType, booleanField.id)).toEqual(['is', 'is_not'])
  })

  it('should support time fields and clear values for empty operators', () => {
    const resourceType = 'workflow'
    const resourceId = 'app-3'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)

    store.ensureResource(resourceType, resourceId)

    const timeField = config.fieldOptions.find(field => field.type === 'time')!
    const item = useEvaluationStore.getState().resources['workflow:app-3'].conditions[0].items[0]

    store.updateConditionField(resourceType, resourceId, useEvaluationStore.getState().resources['workflow:app-3'].conditions[0].id, item.id, timeField.id)
    store.updateConditionOperator(resourceType, resourceId, useEvaluationStore.getState().resources['workflow:app-3'].conditions[0].id, item.id, 'is_empty')

    const updatedItem = useEvaluationStore.getState().resources['workflow:app-3'].conditions[0].items[0]

    expect(getAllowedOperators(resourceType, timeField.id)).toEqual(['is', 'before', 'after', 'is_empty', 'is_not_empty'])
    expect(requiresConditionValue('is_empty')).toBe(false)
    expect(updatedItem.value).toBeNull()
  })
})

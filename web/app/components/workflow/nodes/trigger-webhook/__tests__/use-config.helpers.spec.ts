import type { WebhookTriggerNodeType } from '../types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import {
  syncVariables,
  updateContentType,
  updateMethod,
  updateSimpleField,
  updateSourceFields,
  updateWebhookUrls,
} from '../use-config.helpers'
import { WEBHOOK_RAW_VARIABLE_NAME } from '../utils/raw-variable'

const createInputs = (): WebhookTriggerNodeType => ({
  title: 'Webhook',
  desc: '',
  type: BlockEnum.TriggerWebhook,
  method: 'POST',
  content_type: 'application/json',
  headers: [],
  params: [],
  body: [],
  async_mode: false,
  status_code: 200,
  response_body: '',
  variables: [
    { variable: 'existing_header', label: 'header', required: false, value_selector: [], value_type: VarType.string },
    { variable: 'body_value', label: 'body', required: true, value_selector: [], value_type: VarType.string },
  ],
} as unknown as WebhookTriggerNodeType)

describe('trigger webhook config helpers', () => {
  it('syncs variables, updates existing ones and validates names', () => {
    const notifyError = vi.fn()
    const isVarUsedInNodes = vi.fn(([_, variable]) => variable === 'old_param')
    const removeUsedVarInNodes = vi.fn()
    const draft = {
      ...createInputs(),
      variables: [
        { variable: 'old_param', label: 'param', required: true, value_selector: [], value_type: VarType.number },
        { variable: 'existing_header', label: 'header', required: false, value_selector: [], value_type: VarType.string },
      ],
    }

    expect(syncVariables({
      draft,
      id: 'node-1',
      newData: [{ name: 'existing_header', type: VarType.string, required: true }],
      sourceType: 'header',
      notifyError,
      isVarUsedInNodes,
      removeUsedVarInNodes,
    })).toBe(true)
    expect(draft.variables).toContainEqual(expect.objectContaining({
      variable: 'existing_header',
      label: 'header',
      required: true,
    }))

    expect(syncVariables({
      draft,
      id: 'node-1',
      newData: [{ name: '1invalid', type: VarType.string, required: true }],
      sourceType: 'param',
      notifyError,
      isVarUsedInNodes,
      removeUsedVarInNodes,
    })).toBe(false)
    expect(notifyError).toHaveBeenCalledWith('varKeyError.notStartWithNumber')

    expect(syncVariables({
      draft: createInputs(),
      id: 'node-1',
      newData: [
        { name: 'x-request-id', type: VarType.string, required: true },
        { name: 'x-request-id', type: VarType.string, required: false },
      ],
      sourceType: 'header',
      notifyError,
      isVarUsedInNodes,
      removeUsedVarInNodes,
    })).toBe(false)
    expect(notifyError).toHaveBeenCalledWith('variableConfig.varName')

    expect(syncVariables({
      draft: {
        ...createInputs(),
        variables: undefined,
      } as unknown as WebhookTriggerNodeType,
      id: 'node-1',
      newData: [{ name: WEBHOOK_RAW_VARIABLE_NAME, type: VarType.string, required: true }],
      sourceType: 'body',
      notifyError,
      isVarUsedInNodes,
      removeUsedVarInNodes,
    })).toBe(false)
    expect(notifyError).toHaveBeenCalledWith('variableConfig.varName')

    expect(syncVariables({
      draft: createInputs(),
      id: 'node-1',
      newData: [{ name: 'existing_header', type: VarType.string, required: true }],
      sourceType: 'param',
      notifyError,
      isVarUsedInNodes,
      removeUsedVarInNodes,
    })).toBe(false)
    expect(notifyError).toHaveBeenCalledWith('existing_header')

    const removableDraft = {
      ...createInputs(),
      variables: [
        { variable: 'old_param', label: 'param', required: true, value_selector: [], value_type: VarType.number },
      ],
    }
    expect(syncVariables({
      draft: removableDraft,
      id: 'node-1',
      newData: [],
      sourceType: 'param',
      notifyError,
      isVarUsedInNodes,
      removeUsedVarInNodes,
    })).toBe(true)
    expect(removeUsedVarInNodes).toHaveBeenCalledWith(['node-1', 'old_param'])
  })

  it('updates content, source fields and webhook urls', () => {
    const removeUsedVarInNodes = vi.fn()
    const nextContentType = updateContentType({
      inputs: createInputs(),
      id: 'node-1',
      contentType: 'text/plain',
      isVarUsedInNodes: () => true,
      removeUsedVarInNodes,
    })
    expect(nextContentType.body).toEqual([])
    expect(nextContentType.variables.every(item => item.label !== 'body')).toBe(true)
    expect(removeUsedVarInNodes).toHaveBeenCalledWith(['node-1', 'body_value'])

    expect(updateContentType({
      inputs: createInputs(),
      id: 'node-1',
      contentType: 'application/json',
      isVarUsedInNodes: () => false,
      removeUsedVarInNodes,
    }).body).toEqual([])

    expect(updateContentType({
      inputs: {
        ...createInputs(),
        variables: undefined,
      } as unknown as WebhookTriggerNodeType,
      id: 'node-1',
      contentType: 'multipart/form-data',
      isVarUsedInNodes: () => false,
      removeUsedVarInNodes,
    }).body).toEqual([])

    expect(updateSourceFields({
      inputs: createInputs(),
      id: 'node-1',
      sourceType: 'param',
      nextData: [{ name: 'page', type: VarType.number, required: true }],
      notifyError: vi.fn(),
      isVarUsedInNodes: () => false,
      removeUsedVarInNodes: vi.fn(),
    }).params).toEqual([{ name: 'page', type: VarType.number, required: true }])

    expect(updateSourceFields({
      inputs: createInputs(),
      id: 'node-1',
      sourceType: 'body',
      nextData: [{ name: 'payload', type: VarType.string, required: true }],
      notifyError: vi.fn(),
      isVarUsedInNodes: () => false,
      removeUsedVarInNodes: vi.fn(),
    }).body).toEqual([{ name: 'payload', type: VarType.string, required: true }])

    expect(updateSourceFields({
      inputs: createInputs(),
      id: 'node-1',
      sourceType: 'header',
      nextData: [{ name: 'x-request-id', required: true }],
      notifyError: vi.fn(),
      isVarUsedInNodes: () => false,
      removeUsedVarInNodes: vi.fn(),
    }).headers).toEqual([{ name: 'x-request-id', required: true }])

    expect(updateMethod(createInputs(), 'GET').method).toBe('GET')
    expect(updateSimpleField(createInputs(), 'status_code', 204).status_code).toBe(204)
    expect(updateWebhookUrls(createInputs(), 'https://hook', 'https://debug')).toEqual(expect.objectContaining({
      webhook_url: 'https://hook',
      webhook_debug_url: 'https://debug',
    }))
  })
})

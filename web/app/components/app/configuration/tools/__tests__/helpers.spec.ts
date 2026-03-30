import type { ExternalDataToolProvider } from '../helpers'
import type { CodeBasedExtensionForm, ExternalDataTool } from '@/models/common'
import { describe, expect, it } from 'vitest'
import { LanguagesSupported } from '@/i18n-config/language'
import {

  findExternalDataToolVariableConflict,
  formatExternalDataToolForSave,
  getExternalDataToolDefaultConfig,
  getExternalDataToolValidationError,
  getInitialExternalDataTool,
  removeExternalDataTool,
  upsertExternalDataTool,
} from '../helpers'

const createProviderField = (overrides: Partial<CodeBasedExtensionForm> = {}): CodeBasedExtensionForm => ({
  default: 'default-region',
  label: {
    'en-US': 'Region',
    'zh-Hans': '地区',
  } as CodeBasedExtensionForm['label'],
  options: [],
  placeholder: '',
  required: true,
  type: 'text-input',
  variable: 'region',
  ...overrides,
})

const provider: ExternalDataToolProvider = {
  key: 'custom-tool',
  name: 'Custom tool',
  form_schema: [createProviderField()],
}

const createTool = (overrides: Partial<ExternalDataTool> = {}): ExternalDataTool => ({
  config: {},
  icon: '🤖',
  icon_background: '#fff',
  label: 'External tool',
  type: 'api',
  variable: 'tool_var',
  ...overrides,
})

describe('configuration/tools/helpers', () => {
  it('should initialize new tools with the api type', () => {
    expect(getInitialExternalDataTool({} as ExternalDataTool)).toEqual({
      type: 'api',
    })
    expect(getInitialExternalDataTool(createTool({ type: 'custom-tool' }))).toEqual(createTool({ type: 'custom-tool' }))
  })

  it('should derive default configs from non-system providers only', () => {
    expect(getExternalDataToolDefaultConfig('api', [provider])).toBeUndefined()
    expect(getExternalDataToolDefaultConfig('custom-tool', [provider])).toEqual({
      region: 'default-region',
    })
    expect(getExternalDataToolDefaultConfig('missing-provider', [provider])).toBeUndefined()
  })

  it('should upsert and remove external data tools by index', () => {
    const first = createTool({ label: 'First' })
    const second = createTool({ label: 'Second', variable: 'second_var' })

    expect(upsertExternalDataTool([first], second, -1)).toEqual([first, second])
    expect(upsertExternalDataTool([first, second], createTool({ label: 'Updated second', variable: 'second_var' }), 1)).toEqual([
      first,
      createTool({ label: 'Updated second', variable: 'second_var' }),
    ])
    expect(removeExternalDataTool([first, second], 0)).toEqual([second])
  })

  it('should detect conflicts with prompt variables and other external tools', () => {
    const existing = [
      createTool(),
      createTool({ label: 'Second', variable: 'second_var' }),
    ]

    expect(findExternalDataToolVariableConflict(undefined, existing, [], -1)).toBeUndefined()
    expect(findExternalDataToolVariableConflict('prompt_var', existing, [{ key: 'prompt_var' }], -1)).toBe('prompt_var')
    expect(findExternalDataToolVariableConflict('second_var', existing, [], -1)).toBe('second_var')
    expect(findExternalDataToolVariableConflict('second_var', existing, [], 1)).toBeUndefined()
  })

  it('should format api and custom tools for save', () => {
    const apiTool = createTool({
      config: {
        api_based_extension_id: 'extension-1',
        region: 'ignored',
      },
    })

    const customTool = createTool({
      config: {
        region: 'us',
        ignored: 'value',
      },
      type: 'custom-tool',
    })

    expect(formatExternalDataToolForSave(apiTool, undefined, true)).toEqual(expect.objectContaining({
      enabled: true,
      config: {
        api_based_extension_id: 'extension-1',
      },
    }))

    expect(formatExternalDataToolForSave(customTool, provider, false)).toEqual(expect.objectContaining({
      enabled: false,
      config: {
        region: 'us',
      },
    }))
  })

  it('should return required and invalid validation errors', () => {
    expect(getExternalDataToolValidationError({
      localeData: createTool({ type: '' }),
      currentProvider: undefined,
      locale: 'en-US',
    })).toEqual({
      kind: 'required',
      label: 'feature.tools.modal.toolType.title',
    })

    expect(getExternalDataToolValidationError({
      localeData: createTool({ label: '' }),
      currentProvider: undefined,
      locale: 'en-US',
    })).toEqual({
      kind: 'required',
      label: 'feature.tools.modal.name.title',
    })

    expect(getExternalDataToolValidationError({
      localeData: createTool({ variable: '' }),
      currentProvider: undefined,
      locale: 'en-US',
    })).toEqual({
      kind: 'required',
      label: 'feature.tools.modal.variableName.title',
    })

    expect(getExternalDataToolValidationError({
      localeData: createTool({ variable: 'invalid-key!' }),
      currentProvider: undefined,
      locale: 'en-US',
    })).toEqual({
      kind: 'invalid',
      label: 'feature.tools.modal.variableName.title',
    })
  })

  it('should validate required provider fields using the current locale', () => {
    expect(getExternalDataToolValidationError({
      localeData: createTool({
        config: {},
      }),
      currentProvider: undefined,
      locale: LanguagesSupported[1],
    })).toEqual({
      kind: 'required',
      label: 'API 扩展',
    })

    expect(getExternalDataToolValidationError({
      localeData: createTool({
        config: {},
        type: 'custom-tool',
      }),
      currentProvider: provider,
      locale: LanguagesSupported[1],
    })).toEqual({
      kind: 'required',
      label: '地区',
    })

    expect(getExternalDataToolValidationError({
      localeData: createTool({
        config: {
          region: 'us',
        },
        type: 'custom-tool',
      }),
      currentProvider: provider,
      locale: 'en-US',
    })).toBeNull()
  })
})

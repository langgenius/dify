import { LanguagesSupported } from '@/i18n-config/language'
import {
  buildProviders,
  formatExternalDataTool,
  getProviderDefaultConfig,
  getValidationError,
} from '../external-data-tool-modal-utils'

const t = (key: string, options?: Record<string, unknown>) => {
  if (options?.key)
    return `${key}:${options.key as string}`

  return key
}

const codeBasedExtensionList = {
  data: [
    {
      name: 'code-tool',
      label: {
        'en-US': 'Code Provider',
        'zh-Hans': '代码提供方',
      },
      form_schema: [
        {
          variable: 'api_key',
          default: 'default-key',
          required: true,
          type: 'text',
          placeholder: '',
          options: [],
          label: {
            'en-US': 'API Key',
            'zh-Hans': '接口密钥',
          },
        },
      ],
    },
  ],
}

describe('external-data-tool-modal-utils', () => {
  it('should build localized providers and default configs for code-based tools', () => {
    const providers = buildProviders({
      codeBasedExtensionList,
      locale: LanguagesSupported[1],
      t,
    })

    expect(providers).toEqual([
      expect.objectContaining({
        key: 'api',
        name: 'apiBasedExtension.selector.title',
      }),
      expect.objectContaining({
        key: 'code-tool',
        name: '代码提供方',
      }),
    ])

    expect(getProviderDefaultConfig('api', providers)).toBeUndefined()
    expect(getProviderDefaultConfig('code-tool', providers)).toEqual({
      api_key: 'default-key',
    })
  })

  it('should format saved data with provider specific config and creation defaults', () => {
    const providers = buildProviders({
      codeBasedExtensionList,
      locale: 'en-US',
      t,
    })

    const formatted = formatExternalDataTool({
      type: 'code-tool',
      label: 'Search',
      variable: 'search_api',
      config: {
        api_key: 'secret',
        ignored: 'value',
      },
    }, providers[1], false)

    expect(formatted).toEqual({
      type: 'code-tool',
      label: 'Search',
      variable: 'search_api',
      enabled: true,
      config: {
        api_key: 'secret',
      },
    })
  })

  it('should report validation errors for invalid variables and missing provider fields', () => {
    const providers = buildProviders({
      codeBasedExtensionList,
      locale: 'en-US',
      t,
    })

    expect(getValidationError({
      currentProvider: providers[0],
      locale: 'en-US',
      localeData: {
        type: 'api',
        label: 'Search',
        variable: '1-invalid',
        config: {
          api_based_extension_id: 'ext-1',
        },
      },
      t,
    })).toBe('varKeyError.notValid:feature.tools.modal.variableName.title')

    expect(getValidationError({
      currentProvider: providers[1],
      locale: 'en-US',
      localeData: {
        type: 'code-tool',
        label: 'Search',
        variable: 'search_api',
        config: {},
      },
      t,
    })).toBe('errorMessage.valueOfVarRequired:API Key')
  })
})

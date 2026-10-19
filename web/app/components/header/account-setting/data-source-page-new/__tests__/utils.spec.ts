import { describe, expect, it } from 'vite-plus/test'
import { providerConfigToFormSchema } from '../utils'

describe('providerConfigToFormSchema', () => {
  it('should map provider configs to form schemas with en_US fallbacks', () => {
    expect(
      providerConfigToFormSchema({
        name: 'api_key',
        type: 'secret-input',
        label: { en_US: 'API Key', zh_Hans: null, ja_JP: 'APIキー' },
        help: null,
        url: null,
        options: [{ label: { en_US: 'One' }, value: '1' }],
      }),
    ).toEqual({
      name: 'api_key',
      type: 'secret-input',
      label: { en_US: 'API Key', zh_Hans: 'API Key', ja_JP: 'APIキー' },
      required: false,
      multiple: undefined,
      default: undefined,
      scope: undefined,
      url: undefined,
      help: undefined,
      placeholder: undefined,
      options: [{ label: { en_US: 'One', zh_Hans: 'One' }, value: '1' }],
    })
  })

  it('should fall back to the config name when no label is declared', () => {
    expect(providerConfigToFormSchema({ name: 'region', type: 'text-input' }).label).toBe('region')
  })
})

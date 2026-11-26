import type { ToolNodeType } from '../types'
import { CollectionType } from '@/app/components/tools/types'
import {
  createTool,
  createToolProvider,
} from '@/app/components/workflow/block-selector/__tests__/factories'
import { BlockEnum } from '@/app/components/workflow/types'
import { getToolCheckParams } from '@/app/components/workflow/utils/tool'
import { withSelectorKey } from '@/test/i18n-mock'
import nodeDefault from '../default'

// boundary: output-schema matching is independent of input validation and loads API query hooks.
vi.mock('../output-schema-utils', () => ({ resolveVarType: vi.fn() }))

const t = withSelectorKey((key: string) => key, 'workflow')

describe('tool default node validation', () => {
  it.each([
    ['select', 'llm'],
    ['dynamic-select', 'llm'],
    ['select', 'form'],
    ['dynamic-select', 'form'],
  ] as const)(
    'validates required %s selections from the real %s parameter schema',
    (type, form) => {
      const parameter = {
        name: 'formats',
        label: { en_US: 'Formats', zh_Hans: 'Formats' },
        human_description: { en_US: '', zh_Hans: '' },
        llm_description: '',
        type,
        form,
        required: true,
        multiple: true,
      }
      const provider = createToolProvider({
        is_team_authorization: true,
        tools: [{ ...createTool('export', 'Export'), parameters: [parameter] }],
      })
      const payload: ToolNodeType = {
        ...nodeDefault.defaultValue,
        title: 'Export',
        desc: '',
        type: BlockEnum.Tool,
        provider_id: provider.id,
        provider_name: provider.name,
        provider_type: CollectionType.builtIn,
        tool_name: 'export',
        tool_label: 'Export',
        tool_parameters: { formats: { type: 'constant', value: [] } },
        tool_configurations: { formats: [] },
      }
      const checkParams = getToolCheckParams(payload, [provider], [], [], 'en_US')

      expect(nodeDefault.checkValid(payload, t, checkParams).isValid).toBe(false)
      expect(
        nodeDefault.checkValid(
          {
            ...payload,
            tool_parameters: { formats: { type: 'constant', value: ['pdf'] } },
            tool_configurations: { formats: ['pdf'] },
          },
          t,
          checkParams,
        ).isValid,
      ).toBe(true)

      const optionalProvider = {
        ...provider,
        tools: [{ ...provider.tools[0]!, parameters: [{ ...parameter, required: false }] }],
      }
      const optionalParams = getToolCheckParams(payload, [optionalProvider], [], [], 'en_US')
      expect(nodeDefault.checkValid(payload, t, optionalParams).isValid).toBe(true)
    },
  )

  it('should reject an empty required multi-select input', () => {
    const payload = {
      ...nodeDefault.defaultValue,
      title: 'Tool',
      desc: '',
      type: BlockEnum.Tool,
      tool_parameters: {
        formats: {
          type: 'constant',
          value: [],
        },
      },
    } as ToolNodeType

    const result = nodeDefault.checkValid(payload, t, {
      toolInputsSchema: [
        { variable: 'formats', required: true, label: 'Formats', type: 'select', multiple: true },
      ],
      toolSettingSchema: [],
      language: 'en_US',
      notAuthed: false,
    })

    expect(result).toEqual({
      isValid: false,
      errorMessage: 'errorMsg.fieldRequired',
    })
  })

  it('should accept an explicit empty array for a required array input', () => {
    const payload = {
      ...nodeDefault.defaultValue,
      title: 'Tool',
      desc: '',
      type: BlockEnum.Tool,
      tool_parameters: {
        items: {
          type: 'constant',
          value: [],
        },
      },
    } as ToolNodeType

    const result = nodeDefault.checkValid(payload, t, {
      toolInputsSchema: [{ variable: 'items', required: true, label: 'Items', type: 'array' }],
      toolSettingSchema: [],
      language: 'en_US',
      notAuthed: false,
    })

    expect(result).toEqual({
      isValid: true,
      errorMessage: '',
    })
  })
})

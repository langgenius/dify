import type { ToolNodeType } from '../types'
import { BlockEnum } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import nodeDefault from '../default'

const t = withSelectorKey((key: string) => key, 'workflow')

describe('tool default node validation', () => {
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

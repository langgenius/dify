import type { IconPickerInputValue } from '@/app/components/base/icon-picker'
import { createAgentFormPayload, createAgentIconSelection } from '../agent-form'

describe('createAgentIconSelection', () => {
  it('preserves a Composer image when its response has no resolved icon URL', () => {
    expect(createAgentIconSelection({ icon_type: 'image', icon: 'uploaded-file-id' })).toEqual({
      type: 'image',
      fileId: 'uploaded-file-id',
      url: 'uploaded-file-id',
    })
  })

  it('preserves a Composer link icon', () => {
    expect(
      createAgentIconSelection({ icon_type: 'link', icon: 'https://example.com/icon.png' }),
    ).toEqual({
      type: 'link',
      url: 'https://example.com/icon.png',
    })
  })

  it('uses the resolved image URL while preserving the uploaded file id', () => {
    expect(
      createAgentIconSelection({
        icon: 'uploaded-file-id',
        icon_type: 'image',
        icon_url: 'https://example.com/resolved-agent-icon.png',
      }),
    ).toEqual({
      type: 'image',
      fileId: 'uploaded-file-id',
      url: 'https://example.com/resolved-agent-icon.png',
    })
  })
})

describe('createAgentFormPayload', () => {
  it.each([
    {
      icon: { type: 'emoji', icon: '🧸', background: '#F5F3FF' },
      expected: { icon_type: 'emoji', icon: '🧸', icon_background: '#F5F3FF' },
    },
    {
      icon: { type: 'image', fileId: 'uploaded-file-id', url: 'https://example.com/preview.png' },
      expected: { icon_type: 'image', icon: 'uploaded-file-id', icon_background: undefined },
    },
    {
      icon: { type: 'link', url: 'https://example.com/icon.png' },
      expected: {
        icon_type: 'link',
        icon: 'https://example.com/icon.png',
        icon_background: undefined,
      },
    },
  ] satisfies { icon: IconPickerInputValue; expected: Record<string, unknown> }[])(
    'converts a $icon.type icon at the submission boundary and preserves an empty role',
    ({ icon, expected }) => {
      expect(
        createAgentFormPayload({
          name: ' Research Agent ',
          description: ' Description ',
          role: ' ',
          icon,
        }),
      ).toEqual({ name: 'Research Agent', description: 'Description', role: '', ...expected })
    },
  )
})

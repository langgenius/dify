import { createAgentIconSelection } from '../agent-form'

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
      icon: 'https://example.com/icon.png',
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

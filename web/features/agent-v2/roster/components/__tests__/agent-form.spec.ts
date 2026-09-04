import { createAgentIconSelection } from '../agent-form'

describe('createAgentIconSelection', () => {
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

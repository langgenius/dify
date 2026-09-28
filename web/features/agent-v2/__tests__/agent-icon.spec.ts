import { getAgentIconProps } from '../agent-icon'

describe('getAgentIconProps', () => {
  it('uses the signed icon_url for uploaded image icons instead of the upload file id', () => {
    expect(
      getAgentIconProps({
        icon_type: 'image',
        icon: 'upload-file-id',
        icon_url: 'https://files.example.com/upload-file-id?sign=abc',
      }),
    ).toEqual({
      iconType: 'image',
      imageUrl: 'https://files.example.com/upload-file-id?sign=abc',
    })
  })

  it('does not fall back to the upload file id when an image icon has no icon_url', () => {
    expect(getAgentIconProps({ icon_type: 'image', icon: 'upload-file-id' })).toEqual({
      iconType: 'image',
      imageUrl: undefined,
    })
  })

  it('renders link icons as images using the stored URL', () => {
    expect(
      getAgentIconProps({ icon_type: 'link', icon: 'https://cdn.example.com/agent.png' }),
    ).toEqual({ iconType: 'image', imageUrl: 'https://cdn.example.com/agent.png' })
  })

  it('keeps emoji icons without an image URL', () => {
    expect(getAgentIconProps({ icon_type: 'emoji', icon: 'robot_face' })).toEqual({
      iconType: 'emoji',
    })
  })
})

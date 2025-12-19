import type { Meta, StoryObj } from '@storybook/nextjs'
import { useEffect } from 'react'
import type { ComponentProps } from 'react'
import AudioBtn from '.'
import { ensureMockAudioManager } from '../../../../.storybook/utils/audio-player-manager.mock'

ensureMockAudioManager()

const StoryWrapper = (props: ComponentProps<typeof AudioBtn>) => {
  useEffect(() => {
    ensureMockAudioManager()
  }, [])

  return (
    <div className="flex items-center justify-center space-x-3">
      <AudioBtn {...props} />
      <span className="text-xs text-gray-500">Audio toggle using ActionButton styling</span>
    </div>
  )
}

const meta = {
  title: 'Base/General/NewAudioButton',
  component: AudioBtn,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Updated audio playback trigger styled with `ActionButton`. Behaves like the legacy audio button but adopts the new button design system.',
      },
    },
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/apps/demo-app/text-to-audio',
        params: { appId: 'demo-app' },
      },
    },
  },
  argTypes: {
    id: {
      control: 'text',
      description: 'Message identifier used by the audio request.',
    },
    value: {
      control: 'text',
      description: 'Prompt or response text that will be converted to speech.',
    },
    voice: {
      control: 'text',
      description: 'Voice profile for the generated speech.',
    },
  },
} satisfies Meta<typeof AudioBtn>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: args => <StoryWrapper {...args} />,
  args: {
    id: 'message-1',
    value: 'Listen to the latest assistant message.',
    voice: 'alloy',
  },
}

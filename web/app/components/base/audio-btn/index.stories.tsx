import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { ComponentProps } from 'react'
import { useEffect } from 'react'
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
      <span className="text-xs text-gray-500">Click to toggle playback</span>
    </div>
  )
}

const meta = {
  title: 'Base/General/AudioBtn',
  component: AudioBtn,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Audio playback toggle that streams assistant responses. The story uses a mocked audio player so you can inspect loading and playback states without calling the real API.',
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
      description: 'Message identifier used to scope the audio stream.',
    },
    value: {
      control: 'text',
      description: 'Text content that would be converted to speech.',
    },
    voice: {
      control: 'text',
      description: 'Voice profile used for playback.',
    },
    isAudition: {
      control: 'boolean',
      description: 'Switches to the audition style with minimal padding.',
    },
    className: {
      control: 'text',
      description: 'Optional custom class for the wrapper.',
    },
  },
} satisfies Meta<typeof AudioBtn>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: args => <StoryWrapper {...args} />,
  args: {
    id: 'message-1',
    value: 'This is an audio preview for the current assistant response.',
    voice: 'alloy',
  },
}

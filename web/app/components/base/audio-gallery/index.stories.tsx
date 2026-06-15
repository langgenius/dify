import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import AudioGallery from '.'

const AUDIO_SOURCES = [
  'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3',
]

const meta = {
  title: 'Base/Data Display/AudioGallery',
  component: AudioGallery,
  parameters: {
    docs: {
      description: {
        component: 'List of audio players that render waveform previews and playback controls for each source.',
      },
      source: {
        language: 'tsx',
        code: `
<AudioGallery
  srcs={[
    'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3',
  ]}
/>
        `.trim(),
      },
    },
  },
  tags: ['autodocs'],
  args: {
    srcs: AUDIO_SOURCES,
  },
} satisfies Meta<typeof AudioGallery>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

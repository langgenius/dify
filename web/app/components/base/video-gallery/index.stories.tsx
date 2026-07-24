import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import VideoGallery from '.'

const VIDEO_SOURCES = [
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/forest.mp4',
]

const meta = {
  title: 'Base/Data Display/VideoGallery',
  component: VideoGallery,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Stacked list of video players with custom controls for progress, volume, and fullscreen.',
      },
      source: {
        language: 'tsx',
        code: `
<VideoGallery
  srcs={[
    'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/forest.mp4',
  ]}
/>
        `.trim(),
      },
    },
  },
  tags: ['autodocs'],
  args: {
    srcs: VIDEO_SOURCES,
  },
} satisfies Meta<typeof VideoGallery>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

import type { Meta, StoryObj } from '@storybook/nextjs'
import ImageGallery from '.'

const IMAGE_SOURCES = [
  'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'600\' height=\'400\'><rect width=\'600\' height=\'400\' fill=\'%23E0EAFF\'/><text x=\'50%\' y=\'50%\' dominant-baseline=\'middle\' text-anchor=\'middle\' font-family=\'sans-serif\' font-size=\'48\' fill=\'%23455675\'>Dataset</text></svg>',
  'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'600\' height=\'400\'><rect width=\'600\' height=\'400\' fill=\'%23FEF7C3\'/><text x=\'50%\' y=\'50%\' dominant-baseline=\'middle\' text-anchor=\'middle\' font-family=\'sans-serif\' font-size=\'48\' fill=\'%237A5B00\'>Playground</text></svg>',
  'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'600\' height=\'400\'><rect width=\'600\' height=\'400\' fill=\'%23D5F5F6\'/><text x=\'50%\' y=\'50%\' dominant-baseline=\'middle\' text-anchor=\'middle\' font-family=\'sans-serif\' font-size=\'48\' fill=\'%23045C63\'>Workflow</text></svg>',
  'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'600\' height=\'400\'><rect width=\'600\' height=\'400\' fill=\'%23FCE7F6\'/><text x=\'50%\' y=\'50%\' dominant-baseline=\'middle\' text-anchor=\'middle\' font-family=\'sans-serif\' font-size=\'48\' fill=\'%238E2F63\'>Prompts</text></svg>',
]

const meta = {
  title: 'Base/Data Display/ImageGallery',
  component: ImageGallery,
  parameters: {
    docs: {
      description: {
        component: 'Responsive thumbnail grid with lightbox preview for larger imagery.',
      },
      source: {
        language: 'tsx',
        code: `
<ImageGallery srcs={[
  'data:image/svg+xml;utf8,<svg ... fill=%23E0EAFF ...>',
  'data:image/svg+xml;utf8,<svg ... fill=%23FEF7C3 ...>',
]} />
        `.trim(),
      },
    },
  },
  tags: ['autodocs'],
  args: {
    srcs: IMAGE_SOURCES,
  },
} satisfies Meta<typeof ImageGallery>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

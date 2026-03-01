import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import FileImageRender from './file-image-render'

const SAMPLE_IMAGE = 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'320\' height=\'180\'><defs><linearGradient id=\'grad\' x1=\'0%\' y1=\'0%\' x2=\'100%\' y2=\'100%\'><stop offset=\'0%\' stop-color=\'#FEE2FF\'/><stop offset=\'100%\' stop-color=\'#E0EAFF\'/></linearGradient></defs><rect width=\'320\' height=\'180\' rx=\'18\' fill=\'url(#grad)\'/><text x=\'50%\' y=\'50%\' dominant-baseline=\'middle\' text-anchor=\'middle\' font-family=\'sans-serif\' font-size=\'24\' fill=\'#1F2937\'>Preview</text></svg>'

const meta = {
  title: 'Base/General/FileImageRender',
  component: FileImageRender,
  parameters: {
    docs: {
      description: {
        component: 'Renders image previews inside a bordered frame. Often used in upload galleries and logs.',
      },
      source: {
        language: 'tsx',
        code: `
<FileImageRender imageUrl="https://example.com/preview.png" className="h-32 w-52" />
        `.trim(),
      },
    },
  },
  tags: ['autodocs'],
  args: {
    imageUrl: SAMPLE_IMAGE,
    className: 'h-32 w-52',
  },
} satisfies Meta<typeof FileImageRender>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import SVGRenderer from '.'

const SAMPLE_SVG = `
<svg width="400" height="280" viewBox="0 0 400 280" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#D1E9FF"/>
      <stop offset="100%" stop-color="#FBE8FF"/>
    </linearGradient>
  </defs>
  <rect width="400" height="280" rx="24" fill="url(#bg)"/>
  <g font-family="sans-serif" fill="#1F2937" text-anchor="middle">
    <text x="200" y="120" font-size="32" font-weight="600">SVG Preview</text>
    <text x="200" y="160" font-size="16">Click to open high-resolution preview</text>
  </g>
  <circle cx="320" cy="70" r="28" fill="#E0F2FE" stroke="#2563EB" stroke-width="4"/>
  <circle cx="80" cy="200" r="18" fill="#FDE68A" stroke="#CA8A04" stroke-width="4"/>
  <rect x="120" y="190" width="160" height="48" rx="12" fill="#FFF" opacity="0.85"/>
  <text x="200" y="220" font-size="16" font-weight="500">Inline SVG asset</text>
</svg>
`.trim()

const meta = {
  title: 'Base/Data Display/SVGRenderer',
  component: SVGRenderer,
  parameters: {
    docs: {
      description: {
        component: 'Renders sanitized SVG markup with zoom-to-preview capability.',
      },
      source: {
        language: 'tsx',
        code: `
<SVGRenderer content={\`
  <svg width="400" height="280" ...>...</svg>
\`} />
        `.trim(),
      },
    },
  },
  tags: ['autodocs'],
  args: {
    content: SAMPLE_SVG,
  },
} satisfies Meta<typeof SVGRenderer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

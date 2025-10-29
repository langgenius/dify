import type { Meta, StoryObj } from '@storybook/nextjs'
import { useState } from 'react'
import SVGBtn from '.'

const SvgToggleDemo = () => {
  const [isSVG, setIsSVG] = useState(false)

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <p className="text-xs uppercase tracking-[0.18em] text-text-tertiary">SVG toggle</p>
      <SVGBtn isSVG={isSVG} setIsSVG={setIsSVG} />
      <span className="text-xs text-text-secondary">
        Mode: <code className="rounded bg-background-default px-2 py-1 text-[11px]">{isSVG ? 'SVG' : 'PNG'}</code>
      </span>
    </div>
  )
}

const meta = {
  title: 'Base/General/SVGBtn',
  component: SvgToggleDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Small toggle used in icon pickers to switch between SVG and bitmap assets.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SvgToggleDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

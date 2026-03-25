import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import ParamItem from '.'

type ParamConfig = {
  id: string
  name: string
  tip: string
  value: number
  min: number
  max: number
  step: number
  allowToggle?: boolean
}

const PARAMS: ParamConfig[] = [
  {
    id: 'temperature',
    name: 'Temperature',
    tip: 'Controls randomness. Lower values make the model more deterministic, higher values encourage creativity.',
    value: 0.7,
    min: 0,
    max: 2,
    step: 0.1,
    allowToggle: true,
  },
  {
    id: 'top_p',
    name: 'Top P',
    tip: 'Nucleus sampling keeps only the most probable tokens whose cumulative probability exceeds this threshold.',
    value: 0.9,
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    id: 'frequency_penalty',
    name: 'Frequency Penalty',
    tip: 'Discourages repeating tokens. Increase to reduce repetition.',
    value: 0.2,
    min: 0,
    max: 1,
    step: 0.05,
  },
]

const ParamItemPlayground = () => {
  const [state, setState] = useState<Record<string, { value: number, enabled: boolean }>>(() => {
    return PARAMS.reduce((acc, item) => {
      acc[item.id] = { value: item.value, enabled: true }
      return acc
    }, {} as Record<string, { value: number, enabled: boolean }>)
  })

  const handleChange = (id: string, value: number) => {
    setState(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        value: Number.parseFloat(value.toFixed(3)),
      },
    }))
  }

  const handleToggle = (id: string, enabled: boolean) => {
    setState(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        enabled,
      },
    }))
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-5 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-text-tertiary">
        <span>Generation parameters</span>
        <code className="rounded-md border border-divider-subtle bg-background-default px-2 py-1 text-[11px] text-text-tertiary">
          {JSON.stringify(state, null, 0)}
        </code>
      </div>
      {PARAMS.map(param => (
        <ParamItem
          key={param.id}
          className="rounded-xl border border-transparent px-3 py-2 hover:border-divider-subtle hover:bg-background-default-subtle"
          id={param.id}
          name={param.name}
          tip={param.tip}
          value={state[param.id].value}
          enable={state[param.id].enabled}
          min={param.min}
          max={param.max}
          step={param.step}
          hasSwitch={param.allowToggle}
          onChange={handleChange}
          onSwitchChange={handleToggle}
        />
      ))}
    </div>
  )
}

const meta = {
  title: 'Base/Data Entry/ParamItem',
  component: ParamItemPlayground,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Slider + numeric input pairing used for model parameter tuning. Supports optional enable toggles per parameter.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ParamItemPlayground>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

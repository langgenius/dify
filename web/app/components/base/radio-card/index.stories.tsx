import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { RiDatabase2Line, RiFileList3Line, RiRocketLine } from '@remixicon/react'
import { useState } from 'react'
import RadioCard from '.'

const meta = {
  title: 'Base/Data Entry/RadioCard',
  component: RadioCard,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Radio card for rich single-choice options. Put selectable cards inside `RadioGroup`; the card passes radio props through to `RadioItem` and uses `RadioControl` for the visual dot.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    noRadio: true,
    icon: <RiRocketLine className="size-5 text-purple-600" />,
    title: 'Standard',
    description: 'Balanced defaults for most retrieval workflows.',
  },
} satisfies Meta<typeof RadioCard>

export default meta
type Story = StoryObj<typeof meta>

function SelectableCardsDemo() {
  const [selected, setSelected] = useState('standard')

  const options = [
    {
      value: 'standard',
      icon: <RiRocketLine className="size-5 text-purple-600" />,
      iconBgClassName: 'bg-purple-100',
      title: 'Standard',
      description: 'Balanced defaults for most retrieval workflows.',
    },
    {
      value: 'advanced',
      icon: <RiDatabase2Line className="size-5 text-blue-600" />,
      iconBgClassName: 'bg-blue-100',
      title: 'Advanced',
      description: 'Expose extra controls when this option is selected.',
      chosenConfig: (
        <div className="rounded-lg bg-components-panel-bg-blur p-3 system-xs-regular text-text-tertiary">
          Additional configuration appears below the selected card.
        </div>
      ),
    },
  ]

  return (
    <RadioGroup
      aria-label="Retrieval mode"
      value={selected}
      onValueChange={setSelected}
      className="w-110 flex-col items-stretch gap-2"
    >
      {options.map(option => (
        <RadioCard
          key={option.value}
          value={option.value}
          icon={option.icon}
          iconBgClassName={option.iconBgClassName}
          title={option.title}
          description={option.description}
          chosenConfig={option.chosenConfig}
        />
      ))}
    </RadioGroup>
  )
}

export const SelectableCards: Story = {
  render: () => <SelectableCardsDemo />,
}

export const StaticInfoCard: Story = {
  render: () => (
    <div className="w-110">
      <RadioCard
        noRadio
        icon={<RiFileList3Line className="size-5 text-indigo-600" />}
        iconBgClassName="bg-indigo-100"
        title="Current Retrieval Method"
        description="This card summarizes the active method and is not a selectable radio option."
        chosenConfig={(
          <div className="flex gap-6 system-xs-regular text-text-tertiary">
            <span>Top K: 5</span>
            <span>Score: 0.8</span>
          </div>
        )}
      />
    </div>
  ),
}

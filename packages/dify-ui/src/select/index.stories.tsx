import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, waitFor, within } from 'storybook/test'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '.'
import { Button } from '../button'
import { Field, FieldDescription } from '../field'
import { Form } from '../form'

const triggerWidth = 'w-64'

const cityItems = [
  { label: 'Seattle', value: 'seattle' },
  { label: 'New York', value: 'new-york' },
  { label: 'Tokyo', value: 'tokyo' },
  { label: 'Paris', value: 'paris' },
]

const deploymentRegionItems = [
  { label: 'US East', value: 'us-east' },
  { label: 'Europe West', value: 'eu-west' },
  { label: 'Asia Pacific', value: 'ap-southeast' },
] as const

type DeploymentRegion = (typeof deploymentRegionItems)[number]['value']

const meta = {
  title: 'Base/Form/Select',
  component: Select,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Compound select built on Base UI Select. Compose `SelectTrigger`, `SelectContent`, and `SelectItem` to build accessible single- or multiple-value pickers with groups, labels, separators, and keyboard selection.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className={triggerWidth}>
      <Select items={cityItems} defaultValue="seattle">
        <SelectTrigger aria-label="City">
          <SelectValue placeholder="Select a city" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="seattle">
            <SelectItemText>Seattle</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          <SelectItem value="new-york">
            <SelectItemText>New York</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          <SelectItem value="tokyo">
            <SelectItemText>Tokyo</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          <SelectItem value="paris">
            <SelectItemText>Paris</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole('combobox', { name: 'City' })
    const body = within(canvasElement.ownerDocument.body)

    await expect(trigger).toHaveTextContent('Seattle')

    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')

    await waitFor(async () => {
      await expect(body.getByRole('option', { name: 'Tokyo' })).toBeVisible()
    })

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await expect(trigger).toHaveTextContent('Tokyo')

    await userEvent.keyboard('{Escape}')
    await waitFor(async () => {
      await expect(body.queryByRole('listbox', { name: 'City options' })).not.toBeInTheDocument()
    })
  },
}

export const WithVisibleLabel: Story = {
  render: () => (
    <div className={triggerWidth}>
      <Select defaultValue="seattle">
        <SelectLabel>City</SelectLabel>
        <SelectTrigger>
          <SelectValue placeholder="Select a city" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="seattle">
            <SelectItemText>Seattle</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          <SelectItem value="new-york">
            <SelectItemText>New York</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
}

export const WithPlaceholder: Story = {
  render: () => (
    <div className={triggerWidth}>
      <Select>
        <SelectTrigger aria-label="Model">
          <SelectValue placeholder="Choose a model" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="gpt-5">
            <SelectItemText>GPT-5</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          <SelectItem value="claude-opus">
            <SelectItemText>Claude Opus</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          <SelectItem value="gemini-25">
            <SelectItemText>Gemini 2.5</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(['small', 'medium', 'large'] as const).map((size) => (
        <div key={size} className={triggerWidth}>
          <Select defaultValue="seattle">
            <SelectTrigger aria-label={`${size} select`} size={size}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="seattle">
                <SelectItemText>Seattle</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
              <SelectItem value="new-york">
                <SelectItemText>New York</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  ),
}

export const WithGroupsAndSeparator: Story = {
  render: () => (
    <div className={triggerWidth}>
      <Select defaultValue="gpt-5">
        <SelectTrigger aria-label="Model">
          <SelectValue placeholder="Choose a model" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectGroupLabel>OpenAI</SelectGroupLabel>
            <SelectItem value="gpt-5">
              <SelectItemText>GPT-5</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
            <SelectItem value="gpt-4o">
              <SelectItemText>GPT-4o</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectGroupLabel>Anthropic</SelectGroupLabel>
            <SelectItem value="claude-opus">
              <SelectItemText>Claude Opus</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
            <SelectItem value="claude-sonnet">
              <SelectItemText>Claude Sonnet</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectGroupLabel>Google</SelectGroupLabel>
            <SelectItem value="gemini-25">
              <SelectItemText>Gemini 2.5</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
            <SelectItem value="gemini-flash">
              <SelectItemText>Gemini Flash</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  ),
}

export const WithDisabledItem: Story = {
  render: () => (
    <div className={triggerWidth}>
      <Select defaultValue="free">
        <SelectTrigger aria-label="Plan">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="free">
            <SelectItemText>Free</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          <SelectItem value="team">
            <SelectItemText>Team</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          <SelectItem value="enterprise" disabled>
            <SelectItemText>Enterprise (contact sales)</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
}

export const Disabled: Story = {
  render: () => (
    <div className={triggerWidth}>
      <Select defaultValue="seattle">
        <SelectTrigger aria-label="City" disabled>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="seattle">
            <SelectItemText>Seattle</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          <SelectItem value="new-york">
            <SelectItemText>New York</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
}

export const ReadOnly: Story = {
  render: () => (
    <div className={triggerWidth}>
      <Select defaultValue="seattle" items={cityItems} readOnly>
        <SelectTrigger aria-label="City">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="seattle">
            <SelectItemText>Seattle</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          <SelectItem value="new-york">
            <SelectItemText>New York</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
}

const ControlledDemo = () => {
  const [value, setValue] = React.useState<string | null>('balanced')

  return (
    <div className="flex flex-col items-start gap-3">
      <div className={triggerWidth}>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger aria-label="Routing strategy">
            <SelectValue placeholder="Choose a strategy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low-latency">
              <SelectItemText>Low latency</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
            <SelectItem value="balanced">
              <SelectItemText>Balanced</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
            <SelectItem value="high-quality">
              <SelectItemText>High quality</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <span className="text-xs text-text-tertiary">
        Selected:
        {value ?? '—'}
      </span>
    </div>
  )
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
}

const MultipleControlledDemo = () => {
  const [value, setValue] = React.useState<DeploymentRegion[]>(['us-east', 'eu-west'])

  return (
    <div className={triggerWidth}>
      <Select<DeploymentRegion, true>
        items={deploymentRegionItems}
        multiple
        value={value}
        onValueChange={setValue}
      >
        <SelectLabel>Deployment regions</SelectLabel>
        <SelectTrigger>
          <SelectValue<DeploymentRegion, true>>
            {(selectedRegions) => {
              if (!selectedRegions?.length) return 'Choose regions'

              const [firstSelectedRegion] = selectedRegions
              if (!firstSelectedRegion) return 'Choose regions'

              const firstRegion = deploymentRegionItems.find(
                (item) => item.value === firstSelectedRegion,
              )
              const additionalRegionCount = selectedRegions.length - 1
              const firstRegionLabel = firstRegion?.label ?? firstSelectedRegion

              return additionalRegionCount > 0
                ? `${firstRegionLabel} (+${additionalRegionCount} more)`
                : firstRegionLabel
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {deploymentRegionItems.map((item) => (
            <SelectItem<DeploymentRegion> key={item.value} value={item.value}>
              <SelectItemText>{item.label}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export const MultipleControlled: Story = {
  render: () => <MultipleControlledDemo />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole('combobox', { name: 'Deployment regions' })
    const body = within(canvasElement.ownerDocument.body)

    await expect(trigger).toHaveTextContent('US East (+1 more)')
    await userEvent.click(trigger)

    const asiaPacificOption = await body.findByRole('option', { name: 'Asia Pacific' })
    await userEvent.click(asiaPacificOption)

    await expect(trigger).toHaveTextContent('US East (+2 more)')
    await expect(asiaPacificOption).toHaveAttribute('aria-selected', 'true')
  },
}

export const InForm: Story = {
  render: () => (
    <Form aria-label="Timezone form" className="grid w-72 gap-3" onFormSubmit={() => undefined}>
      <Field name="timezone">
        <Select name="timezone" defaultValue="utc">
          <SelectLabel>Timezone</SelectLabel>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="utc">
              <SelectItemText>UTC</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
            <SelectItem value="pst">
              <SelectItemText>Pacific (PST)</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
            <SelectItem value="jst">
              <SelectItemText>Japan (JST)</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          </SelectContent>
        </Select>
        <FieldDescription>Used to schedule workflow runs.</FieldDescription>
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary">
          Save
        </Button>
      </div>
    </Form>
  ),
}

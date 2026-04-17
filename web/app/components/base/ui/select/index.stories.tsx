import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '.'

const triggerWidth = 'w-64'

const meta = {
  title: 'Base/UI/Select',
  component: Select,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compound select built on Base UI Select. Compose `SelectTrigger`, `SelectContent`, and `SelectItem` to build accessible single-value pickers with groups, labels, separators, and keyboard selection.',
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
      <Select defaultValue="seattle">
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
      {(['small', 'medium', 'large'] as const).map(size => (
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
            <SelectLabel>OpenAI</SelectLabel>
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
            <SelectLabel>Anthropic</SelectLabel>
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
            <SelectLabel>Google</SelectLabel>
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
      <Select defaultValue="seattle" readOnly>
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
  const [value, setValue] = useState<string | null>('balanced')

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

export const InForm: Story = {
  render: () => (
    <form
      onSubmit={(event) => {
        event.preventDefault()
      }}
      className="flex w-72 flex-col gap-3"
    >
      <label className="text-xs font-medium text-text-tertiary" htmlFor="timezone">
        Timezone
      </label>
      <Select name="timezone" defaultValue="utc">
        <SelectTrigger id="timezone" aria-label="Timezone">
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
      <button
        type="submit"
        className="h-8 rounded-lg bg-components-button-primary-bg px-3 text-sm text-components-button-primary-text"
      >
        Submit
      </button>
    </form>
  ),
}

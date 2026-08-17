import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, spyOn } from 'storybook/test'
import { Button } from '../button'
import { Field, FieldDescription, FieldLabel } from '../field'
import { IconButton } from '../icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from './index'

const meta = {
  title: 'Base/Form/InputGroup',
  component: InputGroup,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A compound text-input surface for a prefix, suffix, or action. Place the direct InputGroupInput before direct InputGroupAddon children in the DOM, and use align for visual placement; interactive add-ons keep their own semantics and focus.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof InputGroup>

export default meta

type Story = StoryObj<typeof meta>

function InputGroupsDemo() {
  const [passwordVisible, setPasswordVisible] = React.useState(false)

  return (
    <div className="grid w-80 gap-4">
      <Field name="repositoryUrl">
        <FieldLabel>Repository URL</FieldLabel>
        <InputGroup>
          <InputGroupInput
            placeholder="github.com/langgenius/dify"
            autoComplete="url"
            spellCheck={false}
          />
          <InputGroupAddon>https://</InputGroupAddon>
        </InputGroup>
        <FieldDescription>
          https:// is displayed as a fixed prefix and is not part of the input value.
        </FieldDescription>
      </Field>

      <Field name="password">
        <FieldLabel>Password</FieldLabel>
        <InputGroup>
          <InputGroupInput
            type={passwordVisible ? 'text' : 'password'}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
          <InputGroupAddon align="inline-end">
            <IconButton
              size="md"
              aria-label={passwordVisible ? 'Hide password' : 'Show password'}
              onClick={() => setPasswordVisible((visible) => !visible)}
            >
              <span
                className={passwordVisible ? 'i-ri-eye-off-line size-4' : 'i-ri-eye-line size-4'}
                aria-hidden="true"
              />
            </IconButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>
    </div>
  )
}

function InputGroupActionDemo() {
  const apiKey = 'sk-test'
  const [copied, setCopied] = React.useState(false)
  const resetTimerRef = React.useRef<number | undefined>(undefined)

  React.useEffect(() => {
    return () => window.clearTimeout(resetTimerRef.current)
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey)
    } catch {
      return
    }

    setCopied(true)
    window.clearTimeout(resetTimerRef.current)
    resetTimerRef.current = window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Field name="apiKey" className="w-80">
      <FieldLabel>API key</FieldLabel>
      <InputGroup>
        <InputGroupInput value={apiKey} readOnly />
        <InputGroupAddon align="inline-end">
          <Button type="button" size="small" variant="tertiary" onClick={handleCopy}>
            <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
          </Button>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  )
}

export const Basic: Story = {
  render: () => <InputGroupsDemo />,
  play: async ({ canvas, userEvent }) => {
    const passwordInput = canvas.getByLabelText('Password')

    await expect(passwordInput).toHaveAttribute('type', 'password')
    await userEvent.click(canvas.getByRole('button', { name: 'Show password' }))
    await expect(passwordInput).toHaveAttribute('type', 'text')
  },
}

export const WithAction: Story = {
  render: () => <InputGroupActionDemo />,
  play: async ({ canvas, userEvent }) => {
    const writeText = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const input = canvas.getByRole('textbox', { name: 'API key' })
    const copyButton = canvas.getByRole('button', { name: 'Copy' })

    await expect(input).toHaveValue('sk-test')
    await expect(input).toHaveAttribute('readonly')
    expect(input.getBoundingClientRect().width).toBeGreaterThan(0)

    await userEvent.click(copyButton)
    await expect(writeText).toHaveBeenCalledWith('sk-test')
    await expect(canvas.getByRole('button', { name: 'Copied' })).toBeVisible()
  },
}

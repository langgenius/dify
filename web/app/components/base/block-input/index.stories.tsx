import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import BlockInput from '.'

const meta = {
  title: 'Base/Data Entry/BlockInput',
  component: BlockInput,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Block input component with variable highlighting. Supports {{variable}} syntax with validation and visual highlighting of variable names.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: 'text',
      description: 'Input value (supports {{variable}} syntax)',
    },
    className: {
      control: 'text',
      description: 'Wrapper CSS classes',
    },
    highLightClassName: {
      control: 'text',
      description: 'CSS class for highlighted variables (default: text-blue-500)',
    },
    readonly: {
      control: 'boolean',
      description: 'Read-only mode',
    },
  },
} satisfies Meta<typeof BlockInput>

export default meta
type Story = StoryObj<typeof meta>

// Interactive demo wrapper
const BlockInputDemo = (args: any) => {
  const [value, setValue] = useState(args.value || '')
  const [keys, setKeys] = useState<string[]>([])

  return (
    <div style={{ width: '600px' }}>
      <BlockInput
        {...args}
        value={value}
        onConfirm={(newValue, extractedKeys) => {
          setValue(newValue)
          setKeys(extractedKeys)
          console.log('Value confirmed:', newValue)
          console.log('Extracted keys:', extractedKeys)
        }}
      />
      {keys.length > 0 && (
        <div className="mt-4 rounded-lg bg-blue-50 p-3">
          <div className="mb-2 text-sm font-medium text-gray-700">Detected Variables:</div>
          <div className="flex flex-wrap gap-2">
            {keys.map(key => (
              <span key={key} className="rounded bg-blue-500 px-2 py-1 text-xs text-white">
                {key}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Default state
export const Default: Story = {
  render: args => <BlockInputDemo {...args} />,
  args: {
    value: '',
    readonly: false,
  },
}

// With single variable
export const SingleVariable: Story = {
  render: args => <BlockInputDemo {...args} />,
  args: {
    value: 'Hello {{name}}, welcome to the application!',
    readonly: false,
  },
}

// With multiple variables
export const MultipleVariables: Story = {
  render: args => <BlockInputDemo {...args} />,
  args: {
    value: 'Dear {{user_name}},\n\nYour order {{order_id}} has been shipped to {{address}}.\n\nThank you for shopping with us!',
    readonly: false,
  },
}

// Complex template
export const ComplexTemplate: Story = {
  render: args => <BlockInputDemo {...args} />,
  args: {
    value: 'Hi {{customer_name}},\n\nYour {{product_type}} subscription will renew on {{renewal_date}} for {{amount}}.\n\nYour payment method ending in {{card_last_4}} will be charged.\n\nQuestions? Contact us at {{support_email}}.',
    readonly: false,
  },
}

// Read-only mode
export const ReadOnlyMode: Story = {
  render: args => <BlockInputDemo {...args} />,
  args: {
    value: 'This is a read-only template with {{variable1}} and {{variable2}}.\n\nYou cannot edit this content.',
    readonly: true,
  },
}

// Empty state
export const EmptyState: Story = {
  render: args => <BlockInputDemo {...args} />,
  args: {
    value: '',
    readonly: false,
  },
}

// Long content
export const LongContent: Story = {
  render: args => <BlockInputDemo {...args} />,
  args: {
    value: 'Dear {{recipient_name}},\n\nWe are writing to inform you about the upcoming changes to your {{service_name}} account.\n\nEffective {{effective_date}}, your plan will include:\n\n1. Access to {{feature_1}}\n2. {{feature_2}} with unlimited usage\n3. Priority support via {{support_channel}}\n4. Monthly reports sent to {{email_address}}\n\nYour new monthly rate will be {{new_price}}, compared to your current rate of {{old_price}}.\n\nIf you have any questions, please contact our team at {{contact_info}}.\n\nBest regards,\n{{company_name}} Team',
    readonly: false,
  },
}

// Variables with underscores
export const VariablesWithUnderscores: Story = {
  render: args => <BlockInputDemo {...args} />,
  args: {
    value: 'User {{user_id}} from {{user_country}} has {{total_orders}} orders with status {{order_status}}.',
    readonly: false,
  },
}

// Adjacent variables
export const AdjacentVariables: Story = {
  render: args => <BlockInputDemo {...args} />,
  args: {
    value: 'File: {{file_name}}.{{file_extension}} ({{file_size}}{{size_unit}})',
    readonly: false,
  },
}

// Real-world example - Email template
export const EmailTemplate: Story = {
  render: args => <BlockInputDemo {...args} />,
  args: {
    value: 'Subject: Your {{service_name}} account has been created\n\nHi {{first_name}},\n\nWelcome to {{company_name}}! Your account is now active.\n\nUsername: {{username}}\nEmail: {{email}}\n\nGet started at {{app_url}}\n\nThanks,\nThe {{company_name}} Team',
    readonly: false,
  },
}

// Real-world example - Notification template
export const NotificationTemplate: Story = {
  render: args => <BlockInputDemo {...args} />,
  args: {
    value: '🔔 {{user_name}} mentioned you in {{channel_name}}\n\n"{{message_preview}}"\n\nReply now: {{message_url}}',
    readonly: false,
  },
}

// Custom styling
export const CustomStyling: Story = {
  render: args => <BlockInputDemo {...args} />,
  args: {
    value: 'This template uses {{custom_variable}} with custom styling.',
    readonly: false,
    className: 'bg-gray-50 border-2 border-blue-200',
  },
}

// Interactive playground
export const Playground: Story = {
  render: args => <BlockInputDemo {...args} />,
  args: {
    value: 'Try editing this text and adding variables like {{example}}',
    readonly: false,
    className: '',
    highLightClassName: '',
  },
}

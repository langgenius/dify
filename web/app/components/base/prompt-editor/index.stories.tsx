import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'

// Mock component to avoid complex initialization issues
const PromptEditorMock = ({ value, onChange, placeholder, editable, compact, className, wrapperClassName }: any) => {
  const [content, setContent] = useState(value || '')

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value)
    onChange?.(e.target.value)
  }

  return (
    <div className={wrapperClassName}>
      <textarea
        className={`w-full resize-none outline-none ${compact ? 'text-[13px] leading-5' : 'text-sm leading-6'} ${className}`}
        value={content}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={!editable}
        style={{ minHeight: '120px' }}
      />
    </div>
  )
}

const meta = {
  title: 'Base/Data Entry/PromptEditor',
  component: PromptEditorMock,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Rich text prompt editor built on Lexical. Supports variable blocks, context blocks, and slash commands for inserting dynamic content. Use `/` or `{` to trigger component picker.\n\n**Note:** This is a simplified version for Storybook. The actual component uses Lexical editor with advanced features.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: 'text',
      description: 'Editor content',
    },
    placeholder: {
      control: 'text',
      description: 'Placeholder text',
    },
    editable: {
      control: 'boolean',
      description: 'Whether the editor is editable',
    },
    compact: {
      control: 'boolean',
      description: 'Compact mode with smaller text',
    },
    className: {
      control: 'text',
      description: 'CSS class for editor content',
    },
    wrapperClassName: {
      control: 'text',
      description: 'CSS class for editor wrapper',
    },
  },
} satisfies Meta<typeof PromptEditorMock>

export default meta
type Story = StoryObj<typeof meta>

// Interactive demo wrapper
const PromptEditorDemo = (args: any) => {
  const [value, setValue] = useState(args.value || '')

  return (
    <div style={{ width: '600px' }}>
      <div className="min-h-[120px] rounded-lg border border-gray-300 p-4">
        <PromptEditorMock
          {...args}
          value={value}
          onChange={(text: string) => {
            setValue(text)
            console.log('Content changed:', text)
          }}
        />
      </div>
      {value && (
        <div className="mt-4 rounded-lg bg-gray-50 p-3">
          <div className="mb-2 text-xs font-medium text-gray-600">Current Value:</div>
          <div className="whitespace-pre-wrap font-mono text-sm text-gray-800">
            {value}
          </div>
        </div>
      )}
    </div>
  )
}

// Default state
export const Default: Story = {
  render: args => <PromptEditorDemo {...args} />,
  args: {
    placeholder: 'Type / for commands...',
    editable: true,
    compact: false,
  },
}

// With initial value
export const WithInitialValue: Story = {
  render: args => <PromptEditorDemo {...args} />,
  args: {
    value: 'Write a summary about the following topic:\n\nPlease include key points and examples.',
    placeholder: 'Type / for commands...',
    editable: true,
  },
}

// Compact mode
export const CompactMode: Story = {
  render: args => <PromptEditorDemo {...args} />,
  args: {
    value: 'This is a compact editor with smaller text size.',
    placeholder: 'Type / for commands...',
    editable: true,
    compact: true,
  },
}

// Read-only mode
export const ReadOnlyMode: Story = {
  render: args => <PromptEditorDemo {...args} />,
  args: {
    value: 'This content is read-only and cannot be edited.\n\nYou can select and copy text, but not modify it.',
    editable: false,
  },
}

// With variables example
export const WithVariablesExample: Story = {
  render: args => <PromptEditorDemo {...args} />,
  args: {
    value: 'Hello, please analyze the following data and provide insights.',
    placeholder: 'Type / to insert variables...',
    editable: true,
  },
}

// Long content example
export const LongContent: Story = {
  render: args => <PromptEditorDemo {...args} />,
  args: {
    value: `You are a helpful AI assistant. Your task is to provide accurate, helpful, and friendly responses.

Guidelines:
1. Be clear and concise
2. Provide examples when helpful
3. Ask clarifying questions if needed
4. Maintain a professional yet friendly tone

Please analyze the user's request and provide a comprehensive response.`,
    placeholder: 'Enter your prompt...',
    editable: true,
  },
}

// Custom placeholder
export const CustomPlaceholder: Story = {
  render: args => <PromptEditorDemo {...args} />,
  args: {
    placeholder: 'Describe the task you want the AI to perform... (Press / for variables)',
    editable: true,
  },
}

// Multiple editors
const MultipleEditorsDemo = () => {
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.')
  const [userPrompt, setUserPrompt] = useState('')

  return (
    <div style={{ width: '700px' }} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">System Prompt</label>
        <div className="min-h-[100px] rounded-lg border border-gray-300 bg-blue-50 p-4">
          <PromptEditorMock
            value={systemPrompt}
            onChange={setSystemPrompt}
            placeholder="Enter system instructions..."
            editable={true}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">User Prompt</label>
        <div className="min-h-[100px] rounded-lg border border-gray-300 p-4">
          <PromptEditorMock
            value={userPrompt}
            onChange={setUserPrompt}
            placeholder="Enter user message template..."
            editable={true}
          />
        </div>
      </div>
      {(systemPrompt || userPrompt) && (
        <div className="rounded-lg bg-gray-50 p-4">
          <div className="mb-2 text-xs font-medium text-gray-600">Combined Output:</div>
          <div className="whitespace-pre-wrap text-sm text-gray-800">
            {systemPrompt && (
              <>
                <strong>System:</strong>
                {' '}
                {systemPrompt}
                {userPrompt && '\n\n'}
              </>
            )}
            {userPrompt && (
              <>
                <strong>User:</strong>
                {' '}
                {userPrompt}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export const MultipleEditors: Story = {
  render: () => <MultipleEditorsDemo />,
}

// Real-world example - Email template
const EmailTemplateDemo = () => {
  const [subject, setSubject] = useState('Welcome to our platform!')
  const [body, setBody] = useState(`Hi,

Thank you for signing up! We're excited to have you on board.

To get started, please verify your email address by clicking the button below.

Best regards,
The Team`)

  return (
    <div style={{ width: '700px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Email Template Editor</h3>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Subject Line</label>
          <div className="rounded-lg border border-gray-300 p-3">
            <PromptEditorMock
              value={subject}
              onChange={setSubject}
              placeholder="Enter email subject..."
              compact={true}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">Email Body</label>
          <div className="min-h-[200px] rounded-lg border border-gray-300 p-4">
            <PromptEditorMock
              value={body}
              onChange={setBody}
              placeholder="Type your email content... Use / to insert variables"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const EmailTemplate: Story = {
  render: () => <EmailTemplateDemo />,
}

// Real-world example - Chat prompt builder
const ChatPromptBuilderDemo = () => {
  const [prompt, setPrompt] = useState(`Analyze the following conversation and provide insights:

1. Identify the main topics discussed
2. Detect the sentiment and tone
3. Summarize key points
4. Suggest follow-up questions`)

  const [characterCount, setCharacterCount] = useState(prompt.length)

  const handleChange = (text: string) => {
    setPrompt(text)
    setCharacterCount(text.length)
  }

  return (
    <div style={{ width: '700px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Chat Prompt Builder</h3>
        <span className="text-xs text-gray-500">
          {characterCount}
          {' '}
          characters
        </span>
      </div>
      <div className="min-h-[200px] rounded-lg border border-gray-300 bg-gray-50 p-4">
        <PromptEditorMock
          value={prompt}
          onChange={handleChange}
          placeholder="Design your chat prompt... Use / for templates"
        />
      </div>
      <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
        💡
        {' '}
        <strong>Tip:</strong>
        {' '}
        Type
        {' '}
        <code className="rounded bg-blue-100 px-1 py-0.5">/</code>
        {' '}
        to insert variables or templates
      </div>
    </div>
  )
}

export const ChatPromptBuilder: Story = {
  render: () => <ChatPromptBuilderDemo />,
}

// Real-world example - API instruction editor
const APIInstructionEditorDemo = () => {
  const [instructions, setInstructions] = useState(`Process the incoming API request and:

1. Validate all required fields are present
2. Transform the data according to the schema
3. Apply business logic rules
4. Return the formatted response`)

  return (
    <div style={{ width: '700px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">API Processing Instructions</h3>
      <div className="min-h-[180px] rounded-lg border-2 border-indigo-300 bg-indigo-50 p-4">
        <PromptEditorMock
          value={instructions}
          onChange={setInstructions}
          placeholder="Enter processing instructions..."
        />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Save Instructions
        </button>
        <button className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300">
          Test
        </button>
      </div>
    </div>
  )
}

export const APIInstructionEditor: Story = {
  render: () => <APIInstructionEditorDemo />,
}

// Interactive playground
export const Playground: Story = {
  render: args => <PromptEditorDemo {...args} />,
  args: {
    value: '',
    placeholder: 'Type / for commands...',
    editable: true,
    compact: false,
  },
}

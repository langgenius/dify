import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import Textarea from '.'

const meta = {
  title: 'Base/Data Entry/Textarea',
  component: Textarea,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Textarea component with multiple sizes (small, regular, large). Built with class-variance-authority for consistent styling.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['small', 'regular', 'large'],
      description: 'Textarea size',
    },
    value: {
      control: 'text',
      description: 'Textarea value',
    },
    placeholder: {
      control: 'text',
      description: 'Placeholder text',
    },
    disabled: {
      control: 'boolean',
      description: 'Disabled state',
    },
    destructive: {
      control: 'boolean',
      description: 'Error/destructive state',
    },
    rows: {
      control: 'number',
      description: 'Number of visible text rows',
    },
  },
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

// Interactive demo wrapper
const TextareaDemo = (args: any) => {
  const [value, setValue] = useState(args.value || '')

  return (
    <div style={{ width: '500px' }}>
      <Textarea
        {...args}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          console.log('Textarea changed:', e.target.value)
        }}
      />
      {value && (
        <div className="mt-3 text-sm text-gray-600">
          Character count:
          {' '}
          <span className="font-semibold">{value.length}</span>
        </div>
      )}
    </div>
  )
}

// Default state
export const Default: Story = {
  render: args => <TextareaDemo {...args} />,
  args: {
    size: 'regular',
    placeholder: 'Enter text...',
    rows: 4,
    value: '',
  },
}

// Small size
export const SmallSize: Story = {
  render: args => <TextareaDemo {...args} />,
  args: {
    size: 'small',
    placeholder: 'Small textarea...',
    rows: 3,
    value: '',
  },
}

// Large size
export const LargeSize: Story = {
  render: args => <TextareaDemo {...args} />,
  args: {
    size: 'large',
    placeholder: 'Large textarea...',
    rows: 5,
    value: '',
  },
}

// With initial value
export const WithInitialValue: Story = {
  render: args => <TextareaDemo {...args} />,
  args: {
    size: 'regular',
    value: 'This is some initial text content.\n\nIt spans multiple lines.',
    rows: 4,
  },
}

// Disabled state
export const Disabled: Story = {
  render: args => <TextareaDemo {...args} />,
  args: {
    size: 'regular',
    value: 'This textarea is disabled and cannot be edited.',
    disabled: true,
    rows: 3,
  },
}

// Destructive/error state
export const DestructiveState: Story = {
  render: args => <TextareaDemo {...args} />,
  args: {
    size: 'regular',
    value: 'This content has an error.',
    destructive: true,
    rows: 3,
  },
}

// Size comparison
const SizeComparisonDemo = () => {
  const [small, setSmall] = useState('')
  const [regular, setRegular] = useState('')
  const [large, setLarge] = useState('')

  return (
    <div style={{ width: '600px' }} className="space-y-4">
      <div>
        <label className="mb-2 block text-xs font-medium text-gray-600">Small</label>
        <Textarea
          size="small"
          value={small}
          onChange={e => setSmall(e.target.value)}
          placeholder="Small textarea..."
          rows={3}
        />
      </div>
      <div>
        <label className="mb-2 block text-xs font-medium text-gray-600">Regular</label>
        <Textarea
          size="regular"
          value={regular}
          onChange={e => setRegular(e.target.value)}
          placeholder="Regular textarea..."
          rows={4}
        />
      </div>
      <div>
        <label className="mb-2 block text-xs font-medium text-gray-600">Large</label>
        <Textarea
          size="large"
          value={large}
          onChange={e => setLarge(e.target.value)}
          placeholder="Large textarea..."
          rows={5}
        />
      </div>
    </div>
  )
}

export const SizeComparison: Story = {
  render: () => <SizeComparisonDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// State comparison
const StateComparisonDemo = () => {
  const [normal, setNormal] = useState('Normal state')
  const [error, setError] = useState('Error state')

  return (
    <div style={{ width: '500px' }} className="space-y-4">
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">Normal</label>
        <Textarea
          value={normal}
          onChange={e => setNormal(e.target.value)}
          rows={3}
        />
      </div>
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">Destructive</label>
        <Textarea
          value={error}
          onChange={e => setError(e.target.value)}
          destructive
          rows={3}
        />
      </div>
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">Disabled</label>
        <Textarea
          value="Disabled state"
          onChange={() => undefined}
          disabled
          rows={3}
        />
      </div>
    </div>
  )
}

export const StateComparison: Story = {
  render: () => <StateComparisonDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Comment form
const CommentFormDemo = () => {
  const [comment, setComment] = useState('')
  const maxLength = 500

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Leave a Comment</h3>
      <Textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Share your thoughts..."
        rows={5}
        maxLength={maxLength}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {comment.length}
          {' '}
          /
          {maxLength}
          {' '}
          characters
        </span>
        <button
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={comment.trim().length === 0}
        >
          Post Comment
        </button>
      </div>
    </div>
  )
}

export const CommentForm: Story = {
  render: () => <CommentFormDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Feedback form
const FeedbackFormDemo = () => {
  const [feedback, setFeedback] = useState('')
  const [email, setEmail] = useState('')

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-2 text-lg font-semibold">Send Feedback</h3>
      <p className="mb-4 text-sm text-gray-600">Help us improve our product</p>
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Your Email</label>
          <input
            type="email"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="email@example.com"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Your Feedback</label>
          <Textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="Tell us what you think..."
            rows={6}
          />
        </div>
        <button className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
          Submit Feedback
        </button>
      </div>
    </div>
  )
}

export const FeedbackForm: Story = {
  render: () => <FeedbackFormDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Code snippet
const CodeSnippetDemo = () => {
  const [code, setCode] = useState(`function hello() {
  console.log("Hello, world!");
}`)

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Code Editor</h3>
      <Textarea
        value={code}
        onChange={e => setCode(e.target.value)}
        className="font-mono"
        rows={8}
      />
      <div className="mt-4 flex gap-2">
        <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Run Code
        </button>
        <button className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300">
          Copy
        </button>
      </div>
    </div>
  )
}

export const CodeSnippet: Story = {
  render: () => <CodeSnippetDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Message composer
const MessageComposerDemo = () => {
  const [message, setMessage] = useState('')

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Compose Message</h3>
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">To</label>
          <input
            type="text"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="Recipient name"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Subject</label>
          <input
            type="text"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="Message subject"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Message</label>
          <Textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Type your message here..."
            rows={8}
          />
        </div>
        <div className="flex gap-2">
          <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Send Message
          </button>
          <button className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300">
            Save Draft
          </button>
        </div>
      </div>
    </div>
  )
}

export const MessageComposer: Story = {
  render: () => <MessageComposerDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Bio editor
const BioEditorDemo = () => {
  const [bio, setBio] = useState('Software developer passionate about building great products.')
  const maxLength = 200

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Edit Your Bio</h3>
      <Textarea
        value={bio}
        onChange={e => setBio(e.target.value.slice(0, maxLength))}
        placeholder="Tell us about yourself..."
        rows={4}
      />
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className={bio.length > maxLength * 0.9 ? 'text-orange-600' : 'text-gray-500'}>
          {bio.length}
          {' '}
          /
          {maxLength}
          {' '}
          characters
        </span>
        {bio.length > maxLength * 0.9 && (
          <span className="text-orange-600">
            {maxLength - bio.length}
            {' '}
            characters remaining
          </span>
        )}
      </div>
      <div className="mt-4 rounded-lg bg-gray-50 p-4">
        <div className="mb-2 text-xs font-medium text-gray-600">Preview:</div>
        <p className="text-sm text-gray-800">{bio || 'Your bio will appear here...'}</p>
      </div>
    </div>
  )
}

export const BioEditor: Story = {
  render: () => <BioEditorDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - JSON editor
const JSONEditorDemo = () => {
  const [json, setJson] = useState(`{
  "name": "John Doe",
  "age": 30,
  "email": "john@example.com"
}`)
  const [isValid, setIsValid] = useState(true)

  const validateJSON = (value: string) => {
    try {
      JSON.parse(value)
      setIsValid(true)
    }
    catch {
      setIsValid(false)
    }
  }

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">JSON Editor</h3>
        <span className={`rounded px-2 py-1 text-xs ${isValid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {isValid ? '✓ Valid' : '✗ Invalid'}
        </span>
      </div>
      <Textarea
        value={json}
        onChange={(e) => {
          setJson(e.target.value)
          validateJSON(e.target.value)
        }}
        className="font-mono"
        destructive={!isValid}
        rows={10}
      />
      <div className="mt-4 flex gap-2">
        <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" disabled={!isValid}>
          Save JSON
        </button>
        <button
          className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
          onClick={() => {
            try {
              const formatted = JSON.stringify(JSON.parse(json), null, 2)
              setJson(formatted)
            }
            catch {
              // Invalid JSON, do nothing
            }
          }}
        >
          Format
        </button>
      </div>
    </div>
  )
}

export const JSONEditor: Story = {
  render: () => <JSONEditorDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Task description
const TaskDescriptionDemo = () => {
  const [title, setTitle] = useState('Implement user authentication')
  const [description, setDescription] = useState('Add login and registration functionality with JWT tokens.')

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Create New Task</h3>
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Task Title</label>
          <input
            type="text"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Description</label>
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe the task in detail..."
            rows={6}
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Priority</label>
          <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
            <option>Urgent</option>
          </select>
        </div>
        <button className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Create Task
        </button>
      </div>
    </div>
  )
}

export const TaskDescription: Story = {
  render: () => <TaskDescriptionDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Interactive playground
export const Playground: Story = {
  render: args => <TextareaDemo {...args} />,
  args: {
    size: 'regular',
    placeholder: 'Enter text...',
    rows: 4,
    disabled: false,
    destructive: false,
    value: '',
  },
}

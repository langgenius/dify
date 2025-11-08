import type { Meta, StoryObj } from '@storybook/nextjs'
import { useState } from 'react'
import Checkbox from '.'

// Helper function for toggling items in an array
const createToggleItem = <T extends { id: string; checked: boolean }>(
  items: T[],
  setItems: (items: T[]) => void,
) => (id: string) => {
  setItems(items.map(item =>
    item.id === id ? { ...item, checked: !item.checked } as T : item,
  ))
}

const meta = {
  title: 'Base/Data Entry/Checkbox',
  component: Checkbox,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Checkbox component with support for checked, unchecked, indeterminate, and disabled states.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    checked: {
      control: 'boolean',
      description: 'Checked state',
    },
    indeterminate: {
      control: 'boolean',
      description: 'Indeterminate state (partially checked)',
    },
    disabled: {
      control: 'boolean',
      description: 'Disabled state',
    },
    className: {
      control: 'text',
      description: 'Additional CSS classes',
    },
    id: {
      control: 'text',
      description: 'HTML id attribute',
    },
  },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

// Interactive demo wrapper
const CheckboxDemo = (args: any) => {
  const [checked, setChecked] = useState(args.checked || false)

  return (
    <div className="flex items-center gap-3">
      <Checkbox
        {...args}
        checked={checked}
        onCheck={() => {
          if (!args.disabled) {
            setChecked(!checked)
            console.log('Checkbox toggled:', !checked)
          }
        }}
      />
      <span className="text-sm text-gray-700">
        {checked ? 'Checked' : 'Unchecked'}
      </span>
    </div>
  )
}

// Default unchecked
export const Default: Story = {
  render: args => <CheckboxDemo {...args} />,
  args: {
    checked: false,
    disabled: false,
    indeterminate: false,
  },
}

// Checked state
export const Checked: Story = {
  render: args => <CheckboxDemo {...args} />,
  args: {
    checked: true,
    disabled: false,
    indeterminate: false,
  },
}

// Indeterminate state
export const Indeterminate: Story = {
  render: args => <CheckboxDemo {...args} />,
  args: {
    checked: false,
    disabled: false,
    indeterminate: true,
  },
}

// Disabled unchecked
export const DisabledUnchecked: Story = {
  render: args => <CheckboxDemo {...args} />,
  args: {
    checked: false,
    disabled: true,
    indeterminate: false,
  },
}

// Disabled checked
export const DisabledChecked: Story = {
  render: args => <CheckboxDemo {...args} />,
  args: {
    checked: true,
    disabled: true,
    indeterminate: false,
  },
}

// Disabled indeterminate
export const DisabledIndeterminate: Story = {
  render: args => <CheckboxDemo {...args} />,
  args: {
    checked: false,
    disabled: true,
    indeterminate: true,
  },
}

// State comparison
export const StateComparison: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center gap-2">
          <Checkbox checked={false} onCheck={() => undefined} />
          <span className="text-xs text-gray-600">Unchecked</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Checkbox checked={true} onCheck={() => undefined} />
          <span className="text-xs text-gray-600">Checked</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Checkbox checked={false} indeterminate={true} onCheck={() => undefined} />
          <span className="text-xs text-gray-600">Indeterminate</span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center gap-2">
          <Checkbox checked={false} disabled={true} onCheck={() => undefined} />
          <span className="text-xs text-gray-600">Disabled</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Checkbox checked={true} disabled={true} onCheck={() => undefined} />
          <span className="text-xs text-gray-600">Disabled Checked</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Checkbox checked={false} indeterminate={true} disabled={true} onCheck={() => undefined} />
          <span className="text-xs text-gray-600">Disabled Indeterminate</span>
        </div>
      </div>
    </div>
  ),
}

// With labels
const WithLabelsDemo = () => {
  const [items, setItems] = useState([
    { id: '1', label: 'Enable notifications', checked: true },
    { id: '2', label: 'Enable email updates', checked: false },
    { id: '3', label: 'Enable SMS alerts', checked: false },
  ])

  const toggleItem = createToggleItem(items, setItems)

  return (
    <div className="flex flex-col gap-3">
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-3">
          <Checkbox
            id={item.id}
            checked={item.checked}
            onCheck={() => toggleItem(item.id)}
          />
          <label
            htmlFor={item.id}
            className="cursor-pointer text-sm text-gray-700"
            onClick={() => toggleItem(item.id)}
          >
            {item.label}
          </label>
        </div>
      ))}
    </div>
  )
}

export const WithLabels: Story = {
  render: () => <WithLabelsDemo />,
}

// Select all example
const SelectAllExampleDemo = () => {
  const [items, setItems] = useState([
    { id: '1', label: 'Item 1', checked: false },
    { id: '2', label: 'Item 2', checked: false },
    { id: '3', label: 'Item 3', checked: false },
  ])

  const allChecked = items.every(item => item.checked)
  const someChecked = items.some(item => item.checked)
  const indeterminate = someChecked && !allChecked

  const toggleAll = () => {
    const newChecked = !allChecked
    setItems(items.map(item => ({ ...item, checked: newChecked })))
  }

  const toggleItem = createToggleItem(items, setItems)

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-gray-50 p-4">
      <div className="flex items-center gap-3 border-b border-gray-200 pb-3">
        <Checkbox
          checked={allChecked}
          indeterminate={indeterminate}
          onCheck={toggleAll}
        />
        <span className="text-sm font-medium text-gray-700">Select All</span>
      </div>
      <div className="flex flex-col gap-2 pl-7">
        {items.map(item => (
          <div key={item.id} className="flex items-center gap-3">
            <Checkbox
              id={item.id}
              checked={item.checked}
              onCheck={() => toggleItem(item.id)}
            />
            <label
              htmlFor={item.id}
              className="cursor-pointer text-sm text-gray-600"
              onClick={() => toggleItem(item.id)}
            >
              {item.label}
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}

export const SelectAllExample: Story = {
  render: () => <SelectAllExampleDemo />,
}

// Form example
const FormExampleDemo = () => {
  const [formData, setFormData] = useState({
    terms: false,
    newsletter: false,
    privacy: false,
  })

  return (
    <div className="w-96 rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Account Settings</h3>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id="terms"
            checked={formData.terms}
            onCheck={() => setFormData({ ...formData, terms: !formData.terms })}
          />
          <div>
            <label htmlFor="terms" className="cursor-pointer text-sm font-medium text-gray-700">
              I agree to the terms and conditions
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Required to continue
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="newsletter"
            checked={formData.newsletter}
            onCheck={() => setFormData({ ...formData, newsletter: !formData.newsletter })}
          />
          <div>
            <label htmlFor="newsletter" className="cursor-pointer text-sm font-medium text-gray-700">
              Subscribe to newsletter
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Get updates about new features
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="privacy"
            checked={formData.privacy}
            onCheck={() => setFormData({ ...formData, privacy: !formData.privacy })}
          />
          <div>
            <label htmlFor="privacy" className="cursor-pointer text-sm font-medium text-gray-700">
              I have read the privacy policy
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Required to continue
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export const FormExample: Story = {
  render: () => <FormExampleDemo />,
}

// Task list example
const TaskListExampleDemo = () => {
  const [tasks, setTasks] = useState([
    { id: '1', title: 'Review pull request', completed: true },
    { id: '2', title: 'Update documentation', completed: true },
    { id: '3', title: 'Fix navigation bug', completed: false },
    { id: '4', title: 'Deploy to staging', completed: false },
  ])

  const toggleTask = (id: string) => {
    setTasks(tasks.map(task =>
      task.id === id ? { ...task, completed: !task.completed } : task,
    ))
  }

  const completedCount = tasks.filter(t => t.completed).length

  return (
    <div className="w-96 rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Today's Tasks</h3>
        <span className="text-xs text-gray-500">
          {completedCount} of {tasks.length} completed
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {tasks.map(task => (
          <div
            key={task.id}
            className="flex items-center gap-3 rounded p-2 hover:bg-gray-50"
          >
            <Checkbox
              id={task.id}
              checked={task.completed}
              onCheck={() => toggleTask(task.id)}
            />
            <span
              className={`cursor-pointer text-sm ${
                task.completed ? 'text-gray-400 line-through' : 'text-gray-700'
              }`}
              onClick={() => toggleTask(task.id)}
            >
              {task.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export const TaskListExample: Story = {
  render: () => <TaskListExampleDemo />,
}

// Interactive playground
export const Playground: Story = {
  render: args => <CheckboxDemo {...args} />,
  args: {
    checked: false,
    indeterminate: false,
    disabled: false,
    id: 'playground-checkbox',
  },
}

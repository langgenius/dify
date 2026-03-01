import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import TagInput from '.'

const meta = {
  title: 'Base/Data Entry/TagInput',
  component: TagInput,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Tag input component for managing a list of string tags. Features auto-sizing input, duplicate detection, length validation (max 20 chars), and customizable confirm key (Enter or Tab).',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    items: {
      control: 'object',
      description: 'Array of tag strings',
    },
    onChange: {
      action: 'changed',
      description: 'Change handler',
    },
    disableAdd: {
      control: 'boolean',
      description: 'Disable adding new tags',
    },
    disableRemove: {
      control: 'boolean',
      description: 'Disable removing tags',
    },
    customizedConfirmKey: {
      control: 'select',
      options: ['Enter', 'Tab'],
      description: 'Key to confirm tag creation',
    },
    placeholder: {
      control: 'text',
      description: 'Input placeholder text',
    },
    required: {
      control: 'boolean',
      description: 'Require non-empty tags',
    },
  },
  args: {
    onChange: (items) => {
      console.log('Tags updated:', items)
    },
  },
} satisfies Meta<typeof TagInput>

export default meta
type Story = StoryObj<typeof meta>

// Interactive demo wrapper
const TagInputDemo = (args: any) => {
  const [items, setItems] = useState(args.items || [])

  return (
    <div style={{ width: '500px' }}>
      <TagInput
        {...args}
        items={items}
        onChange={(newItems) => {
          setItems(newItems)
          console.log('Tags updated:', newItems)
        }}
      />
      {items.length > 0 && (
        <div className="mt-4 rounded-lg bg-gray-50 p-3">
          <div className="mb-2 text-xs font-medium text-gray-600">
            Current Tags (
            {items.length}
            ):
          </div>
          <div className="font-mono text-sm text-gray-800">
            {JSON.stringify(items, null, 2)}
          </div>
        </div>
      )}
    </div>
  )
}

// Default state (empty)
export const Default: Story = {
  render: args => <TagInputDemo {...args} />,
  args: {
    items: [],
    placeholder: 'Add a tag...',
    customizedConfirmKey: 'Enter',
  },
}

// With initial tags
export const WithInitialTags: Story = {
  render: args => <TagInputDemo {...args} />,
  args: {
    items: ['React', 'TypeScript', 'Next.js'],
    placeholder: 'Add more tags...',
    customizedConfirmKey: 'Enter',
  },
}

// Tab to confirm
export const TabToConfirm: Story = {
  render: args => <TagInputDemo {...args} />,
  args: {
    items: ['keyword1', 'keyword2'],
    placeholder: 'Press Tab to add...',
    customizedConfirmKey: 'Tab',
  },
}

// Disable remove
export const DisableRemove: Story = {
  render: args => <TagInputDemo {...args} />,
  args: {
    items: ['Permanent', 'Tags', 'Cannot be removed'],
    disableRemove: true,
    customizedConfirmKey: 'Enter',
  },
}

// Disable add
export const DisableAdd: Story = {
  render: args => <TagInputDemo {...args} />,
  args: {
    items: ['Read', 'Only', 'Mode'],
    disableAdd: true,
  },
}

// Required tags
export const RequiredTags: Story = {
  render: args => <TagInputDemo {...args} />,
  args: {
    items: [],
    placeholder: 'Add required tags...',
    required: true,
    customizedConfirmKey: 'Enter',
  },
}

// Real-world example - Skill tags
const SkillTagsDemo = () => {
  const [skills, setSkills] = useState(['JavaScript', 'React', 'Node.js'])

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-2 text-lg font-semibold">Your Skills</h3>
      <p className="mb-4 text-sm text-gray-600">Add skills to your profile</p>
      <TagInput
        items={skills}
        onChange={setSkills}
        placeholder="Add a skill..."
        customizedConfirmKey="Enter"
      />
      <div className="mt-4 text-xs text-gray-500">
        💡 Press Enter to add a tag. Max 20 characters. No duplicates allowed.
      </div>
    </div>
  )
}

export const SkillTags: Story = {
  render: () => <SkillTagsDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Email tags
const EmailTagsDemo = () => {
  const [recipients, setRecipients] = useState(['john@example.com', 'jane@example.com'])

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Send Email</h3>
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">To:</label>
          <TagInput
            items={recipients}
            onChange={setRecipients}
            placeholder="Add recipient email..."
            customizedConfirmKey="Enter"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Subject:</label>
          <input
            type="text"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="Enter subject..."
          />
        </div>
        <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-gray-700">
          <strong>
            Recipients (
            {recipients.length}
            ):
          </strong>
          {' '}
          {recipients.join(', ')}
        </div>
      </div>
    </div>
  )
}

export const EmailTags: Story = {
  render: () => <EmailTagsDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Search filters
const SearchFiltersDemo = () => {
  const [filters, setFilters] = useState(['urgent', 'pending'])

  const mockResults = [
    { id: 1, title: 'Task 1', tags: ['urgent', 'pending'] },
    { id: 2, title: 'Task 2', tags: ['urgent'] },
    { id: 3, title: 'Task 3', tags: ['pending', 'review'] },
    { id: 4, title: 'Task 4', tags: ['completed'] },
  ]

  const filteredResults = filters.length > 0
    ? mockResults.filter(item => filters.some(filter => item.tags.includes(filter)))
    : mockResults

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Filter Tasks</h3>
      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium text-gray-700">Active Filters:</label>
        <TagInput
          items={filters}
          onChange={setFilters}
          placeholder="Add filter tag..."
          customizedConfirmKey="Enter"
        />
      </div>
      <div className="mt-6">
        <div className="mb-3 text-sm font-medium text-gray-700">
          Results (
          {filteredResults.length}
          {' '}
          of
          {' '}
          {mockResults.length}
          )
        </div>
        <div className="space-y-2">
          {filteredResults.map(item => (
            <div key={item.id} className="rounded-lg bg-gray-50 p-3">
              <div className="text-sm font-medium">{item.title}</div>
              <div className="mt-1 flex gap-1">
                {item.tags.map(tag => (
                  <span key={tag} className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export const SearchFilters: Story = {
  render: () => <SearchFiltersDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Product categories
const ProductCategoriesDemo = () => {
  const [categories, setCategories] = useState(['Electronics', 'Computers'])

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Product Details</h3>
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Product Name</label>
          <input
            type="text"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="Enter product name..."
            defaultValue="Laptop Pro 15"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Categories</label>
          <TagInput
            items={categories}
            onChange={setCategories}
            placeholder="Add category..."
            customizedConfirmKey="Enter"
          />
          <p className="mt-1 text-xs text-gray-500">
            Add relevant categories to help users find this product
          </p>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Description</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            rows={3}
            placeholder="Enter product description..."
          />
        </div>
      </div>
    </div>
  )
}

export const ProductCategories: Story = {
  render: () => <ProductCategoriesDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Keyword extraction
const KeywordExtractionDemo = () => {
  const [keywords, setKeywords] = useState(['AI', 'machine learning', 'automation'])

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">SEO Keywords</h3>
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">
          Meta Keywords
        </label>
        <TagInput
          items={keywords}
          onChange={setKeywords}
          placeholder="Add keyword..."
          customizedConfirmKey="Enter"
          required
        />
        <div className="mt-2 text-xs text-gray-500">
          Add relevant keywords for search engine optimization (max 20 characters each)
        </div>
      </div>
      <div className="mt-6 rounded-lg bg-gray-50 p-4">
        <div className="mb-2 text-xs font-medium text-gray-600">Meta Tag Preview:</div>
        <code className="text-xs text-gray-700">
          &lt;meta name="keywords" content="
          {keywords.join(', ')}
          " /&gt;
        </code>
      </div>
    </div>
  )
}

export const KeywordExtraction: Story = {
  render: () => <KeywordExtractionDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Tags with suggestions
const TagsWithSuggestionsDemo = () => {
  const [tags, setTags] = useState(['design', 'frontend'])
  const suggestions = ['backend', 'devops', 'mobile', 'testing', 'security']

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Project Tags</h3>
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">
          Add Tags
        </label>
        <TagInput
          items={tags}
          onChange={setTags}
          placeholder="Type or select..."
          customizedConfirmKey="Enter"
        />
      </div>
      <div className="mt-4">
        <div className="mb-2 text-xs font-medium text-gray-600">Suggestions:</div>
        <div className="flex flex-wrap gap-2">
          {suggestions
            .filter(s => !tags.includes(s))
            .map(suggestion => (
              <button
                key={suggestion}
                className="cursor-pointer rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
                onClick={() => setTags([...tags, suggestion])}
              >
                +
                {' '}
                {suggestion}
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}

export const TagsWithSuggestions: Story = {
  render: () => <TagsWithSuggestionsDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Stop sequences (Tab mode)
const StopSequencesDemo = () => {
  const [stopSequences, setStopSequences] = useState(['Human:', 'AI:'])

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">AI Model Configuration</h3>
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Temperature
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            defaultValue="0.7"
            className="w-full"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Stop Sequences
          </label>
          <TagInput
            items={stopSequences}
            onChange={setStopSequences}
            placeholder="Press Tab to add..."
            customizedConfirmKey="Tab"
          />
          <p className="mt-1 text-xs text-gray-500">
            💡 Press Tab to add. Press Enter to insert ↵ (newline) in sequence.
          </p>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Max Tokens
          </label>
          <input
            type="number"
            defaultValue="2000"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
    </div>
  )
}

export const StopSequences: Story = {
  render: () => <StopSequencesDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Multi-language tags
const MultiLanguageTagsDemo = () => {
  const [tags, setTags] = useState(['Hello', '你好', 'Bonjour', 'Hola'])

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Internationalization</h3>
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">
          Greeting Translations
        </label>
        <TagInput
          items={tags}
          onChange={setTags}
          placeholder="Add translation..."
          customizedConfirmKey="Enter"
        />
        <div className="mt-2 text-xs text-gray-500">
          Supports multi-language characters (max 20 characters)
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {tags.map((tag, index) => (
          <div key={index} className="rounded bg-gray-50 p-2 text-sm">
            <span className="font-mono">{tag}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export const MultiLanguageTags: Story = {
  render: () => <MultiLanguageTagsDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Validation showcase
const ValidationShowcaseDemo = () => {
  const [tags, setTags] = useState(['valid-tag'])

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Validation Rules</h3>
      <TagInput
        items={tags}
        onChange={setTags}
        placeholder="Try adding tags..."
        customizedConfirmKey="Enter"
        required
      />
      <div className="mt-4 rounded-lg bg-blue-50 p-4">
        <div className="mb-2 text-sm font-medium text-blue-900">Validation Rules:</div>
        <ul className="space-y-1 text-xs text-blue-800">
          <li>✓ Maximum 20 characters per tag</li>
          <li>✓ No duplicate tags allowed</li>
          <li>✓ Cannot add empty tags (when required=true)</li>
          <li>✓ Whitespace is automatically trimmed</li>
        </ul>
      </div>
      <div className="mt-4 rounded-lg bg-yellow-50 p-4">
        <div className="mb-2 text-sm font-medium text-yellow-900">Try these:</div>
        <ul className="space-y-1 text-xs text-yellow-800">
          <li>• Add "valid-tag" → Shows duplicate error</li>
          <li>• Add empty string → Shows empty error</li>
          <li>• Add "this-is-a-very-long-tag-name" → Shows length error</li>
        </ul>
      </div>
    </div>
  )
}

export const ValidationShowcase: Story = {
  render: () => <ValidationShowcaseDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Interactive playground
export const Playground: Story = {
  render: args => <TagInputDemo {...args} />,
  args: {
    items: ['tag1', 'tag2'],
    placeholder: 'Add a tag...',
    customizedConfirmKey: 'Enter',
    disableAdd: false,
    disableRemove: false,
    required: false,
  },
}

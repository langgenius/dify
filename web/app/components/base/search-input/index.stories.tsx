import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import SearchInput from '.'

const meta = {
  title: 'Base/Data Entry/SearchInput',
  component: SearchInput,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Search input component with search icon, clear button, and IME composition support for Asian languages.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: 'text',
      description: 'Search input value',
    },
    onChange: {
      action: 'changed',
      description: 'Change handler',
    },
    placeholder: {
      control: 'text',
      description: 'Placeholder text',
    },
    white: {
      control: 'boolean',
      description: 'White background variant',
    },
    className: {
      control: 'text',
      description: 'Additional CSS classes',
    },
  },
  args: {
    onChange: (v) => {
      console.log('Search value changed:', v)
    },
  },
} satisfies Meta<typeof SearchInput>

export default meta
type Story = StoryObj<typeof meta>

// Interactive demo wrapper
const SearchInputDemo = (args: any) => {
  const [value, setValue] = useState(args.value || '')

  return (
    <div style={{ width: '400px' }}>
      <SearchInput
        {...args}
        value={value}
        onChange={(v) => {
          setValue(v)
          console.log('Search value changed:', v)
        }}
      />
      {value && (
        <div className="mt-3 text-sm text-gray-600">
          Searching for:
          {' '}
          <span className="font-semibold">{value}</span>
        </div>
      )}
    </div>
  )
}

// Default state
export const Default: Story = {
  render: args => <SearchInputDemo {...args} />,
  args: {
    placeholder: 'Search...',
    white: false,
    value: '',
    onChange: (v) => {
      console.log('Search value changed:', v)
    },
  },
}

// White variant
export const WhiteBackground: Story = {
  render: args => <SearchInputDemo {...args} />,
  args: {
    placeholder: 'Search...',
    white: true,
    value: '',
  },
}

// With initial value
export const WithInitialValue: Story = {
  render: args => <SearchInputDemo {...args} />,
  args: {
    value: 'Initial search query',
    placeholder: 'Search...',
    white: false,
  },
}

// Custom placeholder
export const CustomPlaceholder: Story = {
  render: args => <SearchInputDemo {...args} />,
  args: {
    placeholder: 'Search documents, files, and more...',
    white: false,
    value: '',
  },
}

// Real-world example - User list search
const UserListSearchDemo = () => {
  const [searchQuery, setSearchQuery] = useState('')

  const users = [
    { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'Admin' },
    { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'User' },
    { id: 3, name: 'Charlie Brown', email: 'charlie@example.com', role: 'User' },
    { id: 4, name: 'Diana Prince', email: 'diana@example.com', role: 'Editor' },
    { id: 5, name: 'Eve Davis', email: 'eve@example.com', role: 'User' },
  ]

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchQuery.toLowerCase())
    || user.email.toLowerCase().includes(searchQuery.toLowerCase())
    || user.role.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Team Members</h3>
      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search by name, email, or role..."
      />
      <div className="mt-4 space-y-2">
        {filteredUsers.length > 0
          ? (
              filteredUsers.map(user => (
                <div
                  key={user.id}
                  className="rounded-lg border border-gray-200 p-3 hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{user.name}</div>
                      <div className="text-xs text-gray-500">{user.email}</div>
                    </div>
                    <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700">
                      {user.role}
                    </span>
                  </div>
                </div>
              ))
            )
          : (
              <div className="py-8 text-center text-sm text-gray-500">
                No users found matching "
                {searchQuery}
                "
              </div>
            )}
      </div>
      <div className="mt-4 text-xs text-gray-500">
        Showing
        {' '}
        {filteredUsers.length}
        {' '}
        of
        {' '}
        {users.length}
        {' '}
        members
      </div>
    </div>
  )
}

export const UserListSearch: Story = {
  render: () => <UserListSearchDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Product search
const ProductSearchDemo = () => {
  const [searchQuery, setSearchQuery] = useState('')

  const products = [
    { id: 1, name: 'Laptop Pro 15"', category: 'Electronics', price: 1299 },
    { id: 2, name: 'Wireless Mouse', category: 'Accessories', price: 29 },
    { id: 3, name: 'Mechanical Keyboard', category: 'Accessories', price: 89 },
    { id: 4, name: 'Monitor 27" 4K', category: 'Electronics', price: 499 },
    { id: 5, name: 'USB-C Hub', category: 'Accessories', price: 49 },
    { id: 6, name: 'Laptop Stand', category: 'Accessories', price: 39 },
  ]

  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchQuery.toLowerCase())
    || product.category.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Product Catalog</h3>
      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search products..."
        white
      />
      <div className="mt-4 grid grid-cols-2 gap-3">
        {filteredProducts.length > 0
          ? (
              filteredProducts.map(product => (
                <div
                  key={product.id}
                  className="rounded-lg border border-gray-200 p-4 transition-shadow hover:shadow-md"
                >
                  <div className="mb-1 text-sm font-medium">{product.name}</div>
                  <div className="mb-2 text-xs text-gray-500">{product.category}</div>
                  <div className="text-lg font-semibold text-blue-600">
                    $
                    {product.price}
                  </div>
                </div>
              ))
            )
          : (
              <div className="col-span-2 py-8 text-center text-sm text-gray-500">
                No products found
              </div>
            )}
      </div>
    </div>
  )
}

export const ProductSearch: Story = {
  render: () => <ProductSearchDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Documentation search
const DocumentationSearchDemo = () => {
  const [searchQuery, setSearchQuery] = useState('')

  const docs = [
    { id: 1, title: 'Getting Started', category: 'Introduction', excerpt: 'Learn the basics of our platform' },
    { id: 2, title: 'API Reference', category: 'Developers', excerpt: 'Complete API documentation and examples' },
    { id: 3, title: 'Authentication Guide', category: 'Security', excerpt: 'Set up OAuth and API key authentication' },
    { id: 4, title: 'Best Practices', category: 'Guides', excerpt: 'Tips for optimal performance and security' },
    { id: 5, title: 'Troubleshooting', category: 'Support', excerpt: 'Common issues and their solutions' },
  ]

  const filteredDocs = docs.filter(doc =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase())
    || doc.category.toLowerCase().includes(searchQuery.toLowerCase())
    || doc.excerpt.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div style={{ width: '700px' }} className="rounded-lg bg-gray-50 p-6">
      <h3 className="mb-2 text-xl font-bold">Documentation</h3>
      <p className="mb-4 text-sm text-gray-600">Search our comprehensive guides and API references</p>
      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search documentation..."
        white
        className="!h-10"
      />
      <div className="mt-4 space-y-3">
        {filteredDocs.length > 0
          ? (
              filteredDocs.map(doc => (
                <div
                  key={doc.id}
                  className="cursor-pointer rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300"
                >
                  <div className="mb-2 flex items-start justify-between">
                    <h4 className="text-base font-semibold">{doc.title}</h4>
                    <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
                      {doc.category}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">{doc.excerpt}</p>
                </div>
              ))
            )
          : (
              <div className="py-12 text-center">
                <div className="mb-2 text-4xl">🔍</div>
                <div className="text-sm text-gray-500">
                  No documentation found for "
                  {searchQuery}
                  "
                </div>
              </div>
            )}
      </div>
    </div>
  )
}

export const DocumentationSearch: Story = {
  render: () => <DocumentationSearchDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Command palette
const CommandPaletteDemo = () => {
  const [searchQuery, setSearchQuery] = useState('')

  const commands = [
    { id: 1, name: 'Create new document', icon: '📄', shortcut: '⌘N' },
    { id: 2, name: 'Open settings', icon: '⚙️', shortcut: '⌘,' },
    { id: 3, name: 'Search everywhere', icon: '🔍', shortcut: '⌘K' },
    { id: 4, name: 'Toggle sidebar', icon: '📁', shortcut: '⌘B' },
    { id: 5, name: 'Save changes', icon: '💾', shortcut: '⌘S' },
    { id: 6, name: 'Undo last action', icon: '↩️', shortcut: '⌘Z' },
    { id: 7, name: 'Redo last action', icon: '↪️', shortcut: '⌘⇧Z' },
  ]

  const filteredCommands = commands.filter(cmd =>
    cmd.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div style={{ width: '600px' }} className="overflow-hidden rounded-lg border border-gray-300 bg-white shadow-lg">
      <div className="border-b border-gray-200 p-4">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Type a command or search..."
          white
          className="!h-10"
        />
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        {filteredCommands.length > 0
          ? (
              filteredCommands.map(cmd => (
                <div
                  key={cmd.id}
                  className="flex cursor-pointer items-center justify-between border-b border-gray-100 px-4 py-3 last:border-b-0 hover:bg-gray-100"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{cmd.icon}</span>
                    <span className="text-sm">{cmd.name}</span>
                  </div>
                  <kbd className="rounded bg-gray-200 px-2 py-1 font-mono text-xs">
                    {cmd.shortcut}
                  </kbd>
                </div>
              ))
            )
          : (
              <div className="py-8 text-center text-sm text-gray-500">
                No commands found
              </div>
            )}
      </div>
    </div>
  )
}

export const CommandPalette: Story = {
  render: () => <CommandPaletteDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Live search with results count
const LiveSearchWithCountDemo = () => {
  const [searchQuery, setSearchQuery] = useState('')

  const items = [
    'React Documentation',
    'React Hooks',
    'React Router',
    'Redux Toolkit',
    'TypeScript Guide',
    'JavaScript Basics',
    'CSS Grid Layout',
    'Flexbox Tutorial',
    'Node.js Express',
    'MongoDB Guide',
  ]

  const filteredItems = items.filter(item =>
    item.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Learning Resources</h3>
        {searchQuery && (
          <span className="text-sm text-gray-500">
            {filteredItems.length}
            {' '}
            result
            {filteredItems.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search resources..."
      />
      <div className="mt-4 space-y-2">
        {filteredItems.map((item, index) => (
          <div
            key={index}
            className="cursor-pointer rounded-lg border border-gray-200 p-3 transition-colors hover:border-blue-300 hover:bg-blue-50"
          >
            <div className="text-sm font-medium">{item}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export const LiveSearchWithCount: Story = {
  render: () => <LiveSearchWithCountDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Size variations
const SizeVariationsDemo = () => {
  const [value1, setValue1] = useState('')
  const [value2, setValue2] = useState('')
  const [value3, setValue3] = useState('')

  return (
    <div style={{ width: '500px' }} className="space-y-4">
      <div>
        <label className="mb-2 block text-xs font-medium text-gray-600">Default Size</label>
        <SearchInput value={value1} onChange={setValue1} placeholder="Search..." />
      </div>
      <div>
        <label className="mb-2 block text-xs font-medium text-gray-600">Medium Size</label>
        <SearchInput
          value={value2}
          onChange={setValue2}
          placeholder="Search..."
          className="!h-10"
        />
      </div>
      <div>
        <label className="mb-2 block text-xs font-medium text-gray-600">Large Size</label>
        <SearchInput
          value={value3}
          onChange={setValue3}
          placeholder="Search..."
          className="!h-12"
        />
      </div>
    </div>
  )
}

export const SizeVariations: Story = {
  render: () => <SizeVariationsDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Interactive playground
export const Playground: Story = {
  render: args => <SearchInputDemo {...args} />,
  args: {
    value: '',
    placeholder: 'Search...',
    white: false,
  },
}

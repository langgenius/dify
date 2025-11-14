import type { Meta, StoryObj } from '@storybook/nextjs'
import React from 'react'

declare const require: any

type IconComponent = React.ComponentType<Record<string, unknown>>

type IconEntry = {
  name: string
  category: string
  path: string
  Component: IconComponent
}

const iconContext = require.context('./src', true, /\.tsx$/)

const iconEntries: IconEntry[] = iconContext
  .keys()
  .filter((key: string) => !key.endsWith('.stories.tsx') && !key.endsWith('.spec.tsx'))
  .map((key: string) => {
    const mod = iconContext(key)
    const Component = mod.default as IconComponent | undefined
    if (!Component)
      return null

    const relativePath = key.replace(/^\.\//, '')
    const path = `app/components/base/icons/src/${relativePath}`
    const parts = relativePath.split('/')
    const fileName = parts.pop() || ''
    const category = parts.length ? parts.join('/') : '(root)'
    const name = Component.displayName || fileName.replace(/\.tsx$/, '')

    return {
      name,
      category,
      path,
      Component,
    }
  })
  .filter(Boolean) as IconEntry[]

const sortedEntries = [...iconEntries].sort((a, b) => {
  if (a.category === b.category)
    return a.name.localeCompare(b.name)
  return a.category.localeCompare(b.category)
})

const filterEntries = (entries: IconEntry[], query: string) => {
  const normalized = query.trim().toLowerCase()
  if (!normalized)
    return entries

  return entries.filter(entry =>
    entry.name.toLowerCase().includes(normalized)
    || entry.path.toLowerCase().includes(normalized)
    || entry.category.toLowerCase().includes(normalized),
  )
}

const groupByCategory = (entries: IconEntry[]) => entries.reduce((acc, entry) => {
  if (!acc[entry.category])
    acc[entry.category] = []

  acc[entry.category].push(entry)
  return acc
}, {} as Record<string, IconEntry[]>)

const scheduleCopiedReset = (
  value: string,
  setter: React.Dispatch<React.SetStateAction<string | null>>,
) => {
  window.setTimeout(() => {
    setter(prev => (prev === value ? null : prev))
  }, 1200)
}

const PREVIEW_SIZE = 40

const IconGalleryStory = () => {
  const [query, setQuery] = React.useState('')
  const [copiedPath, setCopiedPath] = React.useState<string | null>(null)

  const filtered = React.useMemo(() => filterEntries(sortedEntries, query), [query])

  const grouped = React.useMemo(() => groupByCategory(filtered), [filtered])

  const categoryOrder = React.useMemo(
    () => Object.keys(grouped).sort((a, b) => a.localeCompare(b)),
    [grouped],
  )

  const handleCopy = React.useCallback((text: string) => {
    navigator.clipboard?.writeText(text)
      .then(() => {
        setCopiedPath(text)
        scheduleCopiedReset(text, setCopiedPath)
      })
      .catch(() => {
        setCopiedPath(null)
      })
  }, [])

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ margin: 0 }}>Icon Gallery</h1>
        <p style={{ margin: 0, color: '#5f5f66' }}>
          Browse all icon components sourced from <code>app/components/base/icons/src</code>. Use the search bar
          to filter by name or path.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <input
            style={{
              padding: '8px 12px',
              minWidth: 280,
              borderRadius: 6,
              border: '1px solid #d0d0d5',
            }}
            placeholder="Search icons"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <span style={{ color: '#5f5f66' }}>{filtered.length} icons</span>
        </div>
      </header>
      {categoryOrder.length === 0 && (
        <p style={{ color: '#5f5f66' }}>No icons match the current filter.</p>
      )}
      {categoryOrder.map(category => (
        <section key={category} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{category}</h2>
          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            }}
          >
            {grouped[category].map(entry => (
              <div
                key={entry.path}
                style={{
                  border: '1px solid #e1e1e8',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  minHeight: 140,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 48 }}>
                  <entry.Component style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }} />
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(entry.path)}
                  style={{
                    display: 'inline-flex',
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    font: 'inherit',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: copiedPath === entry.path ? '#00754a' : '#24262c',
                    fontWeight: 600,
                  }}
                >
                  {copiedPath === entry.path ? 'Copied!' : entry.name}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

const meta: Meta<typeof IconGalleryStory> = {
  title: 'Base/Icons/Icon Gallery',
  component: IconGalleryStory,
  parameters: {
    layout: 'fullscreen',
  },
}

export default meta

type Story = StoryObj<typeof IconGalleryStory>

export const All: Story = {
  render: () => <IconGalleryStory />,
}

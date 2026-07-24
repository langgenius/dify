/// <reference types="vite/client" />
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import * as React from 'react'

type IconComponent = React.ComponentType<Record<string, unknown>>
type IconModule = { default: IconComponent }

type IconEntry = {
  name: string
  category: string
  path: string
  Component: IconComponent
}

const iconModules: Record<string, IconModule> = import.meta.glob('./src/**/*.tsx', { eager: true })

const iconEntries: IconEntry[] = Object.entries(iconModules)
  .filter(([key]) => !key.endsWith('.stories.tsx') && !key.endsWith('.spec.tsx'))
  .map(([key, mod]) => {
    const Component = mod.default
    if (!Component)
      return null

    const relativePath = key.replace(/^\.\/src\//, '')
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

const containerStyle: React.CSSProperties = {
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const controlsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
}

const searchInputStyle: React.CSSProperties = {
  padding: '8px 12px',
  minWidth: 280,
  borderRadius: 6,
  border: '1px solid #d0d0d5',
}

const toggleButtonStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid #d0d0d5',
  background: '#fff',
  cursor: 'pointer',
}

const emptyTextStyle: React.CSSProperties = { color: '#5f5f66' }

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #e1e1e8',
  borderRadius: 8,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minHeight: 140,
}

const previewBaseStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  minHeight: 48,
  borderRadius: 6,
}

const nameButtonBaseStyle: React.CSSProperties = {
  display: 'inline-flex',
  padding: 0,
  border: 'none',
  background: 'transparent',
  font: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
  fontWeight: 600,
}

const PREVIEW_SIZE = 40

const IconGalleryStory = () => {
  const [query, setQuery] = React.useState('')
  const [copiedPath, setCopiedPath] = React.useState<string | null>(null)
  const [previewTheme, setPreviewTheme] = React.useState<'light' | 'dark'>('light')

  const filtered = React.useMemo(() => filterEntries(sortedEntries, query), [query])

  const grouped = React.useMemo(() => groupByCategory(filtered), [filtered])

  const categoryOrder = React.useMemo(
    () => Object.keys(grouped).sort((a, b) => a.localeCompare(b)),
    [grouped],
  )

  React.useEffect(() => {
    if (!copiedPath)
      return undefined

    const timerId = window.setTimeout(() => {
      setCopiedPath(null)
    }, 1200)

    return () => window.clearTimeout(timerId)
  }, [copiedPath])

  const handleCopy = React.useCallback((text: string) => {
    navigator.clipboard?.writeText(text)
      .then(() => {
        setCopiedPath(text)
      })
      .catch((err) => {
        console.error('Failed to copy icon path:', err)
      })
  }, [])

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <h1 style={{ margin: 0 }}>Icon Gallery</h1>
        <p style={{ margin: 0, color: '#5f5f66' }}>
          Browse all icon components sourced from
          {' '}
          <code>app/components/base/icons/src</code>
          . Use the search bar
          to filter by name or path.
        </p>
        <div style={controlsStyle}>
          <input
            style={searchInputStyle}
            placeholder="Search icons"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <span style={{ color: '#5f5f66' }}>
            {filtered.length}
            {' '}
            icons
          </span>
          <button
            type="button"
            onClick={() => setPreviewTheme(prev => (prev === 'light' ? 'dark' : 'light'))}
            style={toggleButtonStyle}
          >
            Toggle
            {' '}
            {previewTheme === 'light' ? 'dark' : 'light'}
            {' '}
            preview
          </button>
        </div>
      </header>
      {categoryOrder.length === 0 && (
        <p style={emptyTextStyle}>No icons match the current filter.</p>
      )}
      {categoryOrder.map(category => (
        <section key={category} style={sectionStyle}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{category}</h2>
          <div style={gridStyle}>
            {grouped[category].map(entry => (
              <div key={entry.path} style={cardStyle}>
                <div
                  style={{
                    ...previewBaseStyle,
                    background: previewTheme === 'dark' ? '#1f2024' : '#fff',
                  }}
                >
                  <entry.Component style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }} />
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(entry.path)}
                  style={{
                    ...nameButtonBaseStyle,
                    color: copiedPath === entry.path ? '#00754a' : '#24262c',
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

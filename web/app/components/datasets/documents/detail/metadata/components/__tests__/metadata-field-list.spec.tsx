import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MetadataFieldList from '../metadata-field-list'

vi.mock('@/hooks/use-metadata', () => ({
  useMetadataMap: () => ({
    book: {
      text: 'Book',
      subFieldsMap: {
        title: { label: 'Title', inputType: 'input' },
        language: { label: 'Language', inputType: 'select' },
        author: { label: 'Author', inputType: 'input' },
      },
    },
    originInfo: {
      text: 'Origin Info',
      subFieldsMap: {
        source: { label: 'Source', inputType: 'input' },
        hit_count: { label: 'Hit Count', inputType: 'input', render: (val: number, segCount?: number) => `${val} / ${segCount}` },
      },
    },
  }),
  useLanguages: () => ({ en: 'English', zh: 'Chinese' }),
  useBookCategories: () => ({ fiction: 'Fiction', nonfiction: 'Non-fiction' }),
  usePersonalDocCategories: () => ({}),
  useBusinessDocCategories: () => ({}),
}))

describe('MetadataFieldList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Verify rendering of metadata fields based on mainField
  describe('Rendering', () => {
    it('should render all fields for the given mainField', () => {
      render(
        <MetadataFieldList
          mainField="book"
          metadata={{ title: 'Test Book', language: 'en', author: 'John' }}
        />,
      )

      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Language')).toBeInTheDocument()
      expect(screen.getByText('Author')).toBeInTheDocument()
    })

    it('should return null when mainField is empty', () => {
      const { container } = render(
        <MetadataFieldList mainField="" metadata={{}} />,
      )

      expect(container.firstChild).toBeNull()
    })

    it('should display "-" for missing field values', () => {
      render(
        <MetadataFieldList
          mainField="book"
          metadata={{}}
        />,
      )

      // All three fields should show "-"
      const dashes = screen.getAllByText('-')
      expect(dashes.length).toBeGreaterThanOrEqual(3)
    })

    it('should resolve select values to their display name', () => {
      render(
        <MetadataFieldList
          mainField="book"
          metadata={{ language: 'en' }}
        />,
      )

      expect(screen.getByText('English')).toBeInTheDocument()
    })
  })

  // Verify edit mode passes correct props
  describe('Edit Mode', () => {
    it('should render fields in edit mode when canEdit is true', () => {
      render(
        <MetadataFieldList
          mainField="book"
          canEdit={true}
          metadata={{ title: 'Book Title' }}
        />,
      )

      // In edit mode, FieldInfo renders input elements
      const inputs = screen.getAllByRole('textbox')
      expect(inputs.length).toBeGreaterThan(0)
    })

    it('should call onFieldUpdate when a field value changes', () => {
      const onUpdate = vi.fn()
      render(
        <MetadataFieldList
          mainField="book"
          canEdit={true}
          metadata={{ title: '' }}
          onFieldUpdate={onUpdate}
        />,
      )

      // Find the first textbox and type in it
      const inputs = screen.getAllByRole('textbox')
      fireEvent.change(inputs[0], { target: { value: 'New Title' } })

      expect(onUpdate).toHaveBeenCalled()
    })
  })

  // Verify fixed field types use docDetail as source
  describe('Fixed Field Types', () => {
    it('should use docDetail as source data for originInfo type', () => {
      const docDetail = { source: 'Web', hit_count: 42, segment_count: 10 }

      render(
        <MetadataFieldList
          mainField="originInfo"
          docDetail={docDetail as never}
          metadata={{}}
        />,
      )

      expect(screen.getByText('Source')).toBeInTheDocument()
      expect(screen.getByText('Web')).toBeInTheDocument()
    })

    it('should render custom render function output for fields with render', () => {
      const docDetail = { source: 'API', hit_count: 15, segment_count: 5 }

      render(
        <MetadataFieldList
          mainField="originInfo"
          docDetail={docDetail as never}
          metadata={{}}
        />,
      )

      expect(screen.getByText('15 / 5')).toBeInTheDocument()
    })
  })
})

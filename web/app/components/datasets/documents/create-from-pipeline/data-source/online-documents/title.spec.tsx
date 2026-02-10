import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Title from './title'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => `${key}:${(opts?.name as string) || ''}`,
  }),
}))

describe('OnlineDocumentTitle', () => {
  it('should render title with name prop', () => {
    render(<Title name="Notion Workspace" />)
    expect(screen.getByText('onlineDocument.pageSelectorTitle:Notion Workspace')).toBeInTheDocument()
  })
})

import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import ContactsPage from '../page'

const mockConfig = vi.hoisted(() => ({ ENABLE_HITL_IM: false }))

vi.mock('@/config', () => ({
  ENABLE_FEATURE_PREVIEW: true,
  get ENABLE_HITL_IM() {
    return mockConfig.ENABLE_HITL_IM
  },
}))

vi.mock('@/features/contacts/management/composition', () => ({
  ContactsManagementRuntimeProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/features/contacts/management/directory-page', () => ({
  ContactsDirectoryPage: () => <h1>Contacts directory</h1>,
}))

vi.mock('@/next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

describe('Contacts route release gate', () => {
  beforeEach(() => {
    mockConfig.ENABLE_HITL_IM = false
  })

  it('rejects direct navigation before rendering the directory when HITL IM is not released', () => {
    expect(() => ContactsPage()).toThrow('NEXT_NOT_FOUND')
    expect(screen.queryByRole('heading', { name: 'Contacts directory' })).not.toBeInTheDocument()
  })

  it('opens the directory when HITL IM is released', () => {
    mockConfig.ENABLE_HITL_IM = true

    render(<ContactsPage />)

    expect(screen.getByRole('heading', { name: 'Contacts directory' })).toBeInTheDocument()
  })
})

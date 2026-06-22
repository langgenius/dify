import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SourceStepContent } from '../source-step'

vi.mock('@/features/deployments/create-guide/state', async () => {
  const { atom } = await import('jotai')
  const methodAtom = atom<'bindApp' | 'importDsl'>('bindApp')
  const emptyActionAtom = atom(null, () => undefined)

  return {
    continueFromSourceAtom: emptyActionAtom,
    dslFileAtom: atom<File | undefined>(undefined),
    dslReadErrorAtom: atom(false),
    dslUnsupportedModeAtom: atom(false),
    effectiveMethodAtom: atom(get => get(methodAtom)),
    effectiveSelectedAppAtom: atom(undefined),
    isReadingDslAtom: atom(false),
    methodAtom,
    selectDslFileAtom: emptyActionAtom,
    selectMethodAtom: atom(null, (_get, set, value: 'bindApp' | 'importDsl') => {
      set(methodAtom, value)
    }),
    selectSourceAppAtom: emptyActionAtom,
    setSourceSearchTextAtom: emptyActionAtom,
    sourceAppsQueryAtom: atom({
      data: { pages: [{ data: [] }] },
      hasNextPage: false,
      isFetching: false,
      isFetchingNextPage: false,
      isLoading: false,
      isPlaceholderData: false,
      fetchNextPage: vi.fn(),
    }),
    sourceCanGoNextAtom: atom(false),
    sourceSearchTextAtom: atom(''),
    unsupportedDslNodesAtom: atom([]),
  }
})

describe('SourceStepContent', () => {
  it('should hide the import DSL option when deployment DSL import is disabled', () => {
    render(<SourceStepContent />)

    expect(screen.getByText(/createGuide\.methods\.bindApp\.title/)).toBeInTheDocument()
    expect(screen.queryByText(/createGuide\.methods\.importDsl\.title/)).not.toBeInTheDocument()
    expect(screen.queryByText(/createGuide\.methods\.importDsl\.description/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /createGuide\.source\.sourceApp/ })).toBeInTheDocument()
  })
})

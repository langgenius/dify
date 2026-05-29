import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { DocumentContext, useDocumentContext } from '../context'

describe('DocumentContext', () => {
  it('should return the default empty context value when no provider is present', () => {
    const { result } = renderHook(() => useDocumentContext(value => value))

    expect(result.current).toEqual({})
  })

  it('should select values from the nearest provider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DocumentContext.Provider value={{
        datasetId: 'dataset-1',
        documentId: 'document-1',
      }}
      >
        {children}
      </DocumentContext.Provider>
    )

    const { result } = renderHook(
      () => useDocumentContext(value => `${value.datasetId}:${value.documentId}`),
      { wrapper },
    )

    expect(result.current).toBe('dataset-1:document-1')
  })
})

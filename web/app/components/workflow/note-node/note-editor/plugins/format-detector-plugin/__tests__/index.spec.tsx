import { render } from '@testing-library/react'
import { NoteEditorContextProvider } from '../../../context'
import FormatDetectorPlugin from '../index'

const emptyValue = JSON.stringify({ root: { children: [] } })

describe('FormatDetectorPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The plugin should register its observers without rendering extra UI.
  describe('Rendering', () => {
    it('should mount inside the real note editor context without visible output', () => {
      const { container } = render(
        <NoteEditorContextProvider value={emptyValue}>
          <FormatDetectorPlugin />
        </NoteEditorContextProvider>,
      )

      expect(container).toBeEmptyDOMElement()
    })
  })
})

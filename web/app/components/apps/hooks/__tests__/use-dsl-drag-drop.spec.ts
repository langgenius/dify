import { act, renderHook } from '@testing-library/react'
import { useDSLDragDrop } from '../use-dsl-drag-drop'

const file = (name = 'test.yaml') => new File(['content'], name, { type: 'application/x-yaml' })

const dispatch = (
  target: HTMLElement,
  type: string,
  files: File[] | null = [],
  relatedTarget: EventTarget | null = null,
) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    dataTransfer: {
      value: files === null ? null : { files, types: files.length ? ['Files'] : [] },
    },
    relatedTarget: { value: relatedTarget },
  })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

describe('useDSLDragDrop', () => {
  let container: HTMLDivElement
  const onDSLFileDropped = vi.fn()
  beforeEach(() => {
    onDSLFileDropped.mockReset()
    container = document.createElement('div')
    document.body.append(container)
  })
  afterEach(() => {
    container.remove()
  })

  const setup = (enabled = true) => {
    const dropZoneRef = { current: container }
    return renderHook(({ enabled }) => useDSLDragDrop({ dropZoneRef, onDSLFileDropped, enabled }), {
      initialProps: { enabled },
    })
  }

  it('activates only for files, stays active across child elements, and clears on leaving the zone', () => {
    const viewport = document.createElement('div')
    const overlay = document.createElement('div')
    container.append(viewport, overlay)
    const { result } = setup()
    expect(result.current.dragging).toBe(false)
    dispatch(viewport, 'dragenter')
    expect(result.current.dragging).toBe(false)
    dispatch(viewport, 'dragenter', [file()])
    expect(result.current.dragging).toBe(true)
    dispatch(viewport, 'dragleave', [], overlay)
    expect(result.current.dragging).toBe(true)
    dispatch(overlay, 'dragleave', [], document.body)
    expect(result.current.dragging).toBe(false)
  })

  it('prevents the browser default and stops dragover from reaching parent drop zones', () => {
    setup()
    const parentDragOver = vi.fn()
    document.body.addEventListener('dragover', parentDragOver)
    try {
      expect(dispatch(container, 'dragover').defaultPrevented).toBe(true)
      expect(parentDragOver).not.toHaveBeenCalled()
    } finally {
      document.body.removeEventListener('dragover', parentDragOver)
    }
  })

  it.each(['test.yaml', 'test.yml', 'test.YAML', 'agent.ifpkg', 'agent.IFPKG'])(
    'imports the first dropped %s and clears the drag state',
    (filename) => {
      const { result } = setup()
      const first = file(filename)
      dispatch(container, 'dragenter', [first])
      expect(result.current.dragging).toBe(true)
      expect(dispatch(container, 'drop', [first, file('second.yaml')]).defaultPrevented).toBe(true)
      expect(onDSLFileDropped).toHaveBeenCalledExactlyOnceWith(first)
      expect(result.current.dragging).toBe(false)
    },
  )

  it.each([{ files: null }, { files: [] }, { files: [file('test.json')] }])(
    'ignores an unsupported or missing file payload (%j)',
    ({ files }) => {
      const { result } = setup()
      dispatch(container, 'dragenter', [file()])
      dispatch(container, 'drop', files)
      expect(result.current.dragging).toBe(false)
      expect(onDSLFileDropped).not.toHaveBeenCalled()
    },
  )

  it('does not accept files while disabled, including after disabling an active drag', () => {
    const { result, rerender } = setup(false)
    dispatch(container, 'dragenter', [file()])
    dispatch(container, 'drop', [file()])
    expect(result.current.dragging).toBe(false)
    expect(onDSLFileDropped).not.toHaveBeenCalled()
    rerender({ enabled: true })
    dispatch(container, 'dragenter', [file()])
    expect(result.current.dragging).toBe(true)
    rerender({ enabled: false })
    expect(result.current.dragging).toBe(false)
    dispatch(container, 'drop', [file()])
    expect(onDSLFileDropped).not.toHaveBeenCalled()
  })

  it('stops intercepting dropped files after unmount', () => {
    const { unmount } = setup()
    unmount()
    expect(dispatch(container, 'drop', [file()]).defaultPrevented).toBe(false)
    expect(onDSLFileDropped).not.toHaveBeenCalled()
  })
})

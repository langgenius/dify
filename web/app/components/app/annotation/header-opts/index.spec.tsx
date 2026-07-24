import type { ComponentProps } from 'react'
import type { Mock } from 'vitest'
import type { AnnotationItemBasic } from '../type'
import type { Locale } from '@/i18n-config'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { useLocale } from '@/context/i18n'
import { LanguagesSupported } from '@/i18n-config/language'
import { clearAllAnnotations, fetchExportAnnotationList } from '@/service/annotation'
import HeaderOptions from './index'

vi.mock('@headlessui/react', () => {
  type PopoverContextValue = { open: boolean, setOpen: (open: boolean) => void }
  type MenuContextValue = { open: boolean, setOpen: (open: boolean) => void }
  const PopoverContext = React.createContext<PopoverContextValue | null>(null)
  const MenuContext = React.createContext<MenuContextValue | null>(null)

  const Popover = ({ children }: { children: React.ReactNode | ((props: { open: boolean }) => React.ReactNode) }) => {
    const [open, setOpen] = React.useState(false)
    const value = React.useMemo(() => ({ open, setOpen }), [open])
    return (
      <PopoverContext.Provider value={value}>
        {typeof children === 'function' ? children({ open }) : children}
      </PopoverContext.Provider>
    )
  }

  const PopoverButton = React.forwardRef(({ onClick, children, ...props }: { onClick?: () => void, children?: React.ReactNode }, ref: React.Ref<HTMLButtonElement>) => {
    const context = React.useContext(PopoverContext)
    const handleClick = () => {
      context?.setOpen(!context.open)
      onClick?.()
    }
    return (
      <button
        ref={ref}
        type="button"
        aria-expanded={context?.open ?? false}
        onClick={handleClick}
        {...props}
      >
        {children}
      </button>
    )
  })

  const PopoverPanel = React.forwardRef(({ children, ...props }: { children: React.ReactNode | ((props: { close: () => void }) => React.ReactNode) }, ref: React.Ref<HTMLDivElement>) => {
    const context = React.useContext(PopoverContext)
    if (!context?.open)
      return null
    const content = typeof children === 'function' ? children({ close: () => context.setOpen(false) }) : children
    return (
      <div ref={ref} {...props}>
        {content}
      </div>
    )
  })

  const Menu = ({ children }: { children: React.ReactNode }) => {
    const [open, setOpen] = React.useState(false)
    const value = React.useMemo(() => ({ open, setOpen }), [open])
    return (
      <MenuContext.Provider value={value}>
        {children}
      </MenuContext.Provider>
    )
  }

  const MenuButton = ({ onClick, children, ...props }: { onClick?: () => void, children?: React.ReactNode }) => {
    const context = React.useContext(MenuContext)
    const handleClick = () => {
      context?.setOpen(!context.open)
      onClick?.()
    }
    return (
      <button type="button" aria-expanded={context?.open ?? false} onClick={handleClick} {...props}>
        {children}
      </button>
    )
  }

  const MenuItems = ({ children, ...props }: { children: React.ReactNode }) => {
    const context = React.useContext(MenuContext)
    if (!context?.open)
      return null
    return (
      <div {...props}>
        {children}
      </div>
    )
  }

  return {
    Dialog: ({ open, children, className }: { open?: boolean, children: React.ReactNode, className?: string }) => {
      if (open === false)
        return null
      return (
        <div role="dialog" className={className}>
          {children}
        </div>
      )
    },
    DialogBackdrop: ({ children, className, onClick }: { children?: React.ReactNode, className?: string, onClick?: () => void }) => (
      <div className={className} onClick={onClick}>
        {children}
      </div>
    ),
    DialogPanel: ({ children, className, ...props }: { children: React.ReactNode, className?: string }) => (
      <div className={className} {...props}>
        {children}
      </div>
    ),
    DialogTitle: ({ children, className, ...props }: { children: React.ReactNode, className?: string }) => (
      <div className={className} {...props}>
        {children}
      </div>
    ),
    Popover,
    PopoverButton,
    PopoverPanel,
    Menu,
    MenuButton,
    MenuItems,
    Transition: ({ show = true, children }: { show?: boolean, children: React.ReactNode }) => (show ? <>{children}</> : null),
    TransitionChild: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

let lastCSVDownloaderProps: Record<string, unknown> | undefined
const mockCSVDownloader = vi.fn(({ children, ...props }) => {
  lastCSVDownloaderProps = props
  return (
    <div data-testid="csv-downloader">
      {children}
    </div>
  )
})

vi.mock('react-papaparse', () => ({
  useCSVDownloader: () => ({
    CSVDownloader: (props: any) => mockCSVDownloader(props),
    Type: { Link: 'link' },
  }),
}))

vi.mock('@/service/annotation', () => ({
  fetchExportAnnotationList: vi.fn(),
  clearAllAnnotations: vi.fn(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: {
      usage: { annotatedResponse: 0 },
      total: { annotatedResponse: 10 },
    },
    enableBilling: false,
  }),
}))

vi.mock('@/app/components/billing/annotation-full', () => ({
  default: () => <div data-testid="annotation-full" />,
}))

vi.mock('@/context/i18n', () => ({
  useLocale: vi.fn(() => LanguagesSupported[0]),
}))

type HeaderOptionsProps = ComponentProps<typeof HeaderOptions>

const renderComponent = (
  props: Partial<HeaderOptionsProps> = {},
  locale: Locale = LanguagesSupported[0],
) => {
  ;(useLocale as Mock).mockReturnValue(locale)

  const defaultProps: HeaderOptionsProps = {
    appId: 'test-app-id',
    onAdd: vi.fn(),
    onAdded: vi.fn(),
    controlUpdateList: 0,
    ...props,
  }

  return render(<HeaderOptions {...defaultProps} />)
}

const openOperationsPopover = async (user: ReturnType<typeof userEvent.setup>) => {
  const trigger = document.querySelector('button.btn.btn-secondary') as HTMLButtonElement
  expect(trigger).toBeTruthy()
  await user.click(trigger)
}

const expandExportMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await openOperationsPopover(user)
  const exportLabel = await screen.findByText('appAnnotation.table.header.bulkExport')
  const exportButton = exportLabel.closest('button') as HTMLButtonElement
  expect(exportButton).toBeTruthy()
  await user.click(exportButton)
}

const getExportButtons = async () => {
  const csvLabel = await screen.findByText('CSV')
  const jsonLabel = await screen.findByText('JSONL')
  const csvButton = csvLabel.closest('button') as HTMLButtonElement
  const jsonButton = jsonLabel.closest('button') as HTMLButtonElement
  expect(csvButton).toBeTruthy()
  expect(jsonButton).toBeTruthy()
  return {
    csvButton,
    jsonButton,
  }
}

const clickOperationAction = async (
  user: ReturnType<typeof userEvent.setup>,
  translationKey: string,
) => {
  const label = await screen.findByText(translationKey)
  const button = label.closest('button') as HTMLButtonElement
  expect(button).toBeTruthy()
  await user.click(button)
}

const mockAnnotations: AnnotationItemBasic[] = [
  {
    question: 'Question 1',
    answer: 'Answer 1',
  },
]

const mockedFetchAnnotations = vi.mocked(fetchExportAnnotationList)
const mockedClearAllAnnotations = vi.mocked(clearAllAnnotations)

describe('HeaderOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockCSVDownloader.mockClear()
    lastCSVDownloaderProps = undefined
    mockedFetchAnnotations.mockResolvedValue({ data: [] })
  })

  it('should fetch annotations on mount and render enabled export actions when data exist', async () => {
    mockedFetchAnnotations.mockResolvedValue({ data: mockAnnotations })
    const user = userEvent.setup()
    renderComponent()

    await waitFor(() => {
      expect(mockedFetchAnnotations).toHaveBeenCalledWith('test-app-id')
    })

    await expandExportMenu(user)

    const { csvButton, jsonButton } = await getExportButtons()

    expect(csvButton).not.toBeDisabled()
    expect(jsonButton).not.toBeDisabled()

    await waitFor(() => {
      expect(lastCSVDownloaderProps).toMatchObject({
        bom: true,
        filename: 'annotations-en-US',
        type: 'link',
        data: [
          ['Question', 'Answer'],
          ['Question 1', 'Answer 1'],
        ],
      })
    })
  })

  it('should disable export actions when there are no annotations', async () => {
    const user = userEvent.setup()
    renderComponent()

    await expandExportMenu(user)

    const { csvButton, jsonButton } = await getExportButtons()

    expect(csvButton).toBeDisabled()
    expect(jsonButton).toBeDisabled()

    expect(lastCSVDownloaderProps).toMatchObject({
      data: [['Question', 'Answer']],
    })
  })

  it('should open the add annotation modal and forward the onAdd callback', async () => {
    mockedFetchAnnotations.mockResolvedValue({ data: mockAnnotations })
    const user = userEvent.setup()
    const onAdd = vi.fn().mockResolvedValue(undefined)
    renderComponent({ onAdd })

    await waitFor(() => expect(mockedFetchAnnotations).toHaveBeenCalled())

    await user.click(
      screen.getByRole('button', { name: 'appAnnotation.table.header.addAnnotation' }),
    )

    await screen.findByText('appAnnotation.addModal.title')
    const questionInput = screen.getByPlaceholderText('appAnnotation.addModal.queryPlaceholder')
    const answerInput = screen.getByPlaceholderText('appAnnotation.addModal.answerPlaceholder')

    await user.type(questionInput, 'Integration question')
    await user.type(answerInput, 'Integration answer')
    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith({
        question: 'Integration question',
        answer: 'Integration answer',
      })
    })
  })

  it('should allow bulk import through the batch modal', async () => {
    const user = userEvent.setup()
    const onAdded = vi.fn()
    renderComponent({ onAdded })

    await openOperationsPopover(user)
    await clickOperationAction(user, 'appAnnotation.table.header.bulkImport')

    expect(await screen.findByText('appAnnotation.batchModal.title')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'appAnnotation.batchModal.cancel' }),
    )
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('should trigger JSONL download with locale-specific filename', async () => {
    mockedFetchAnnotations.mockResolvedValue({ data: mockAnnotations })
    const user = userEvent.setup()
    const originalCreateElement = document.createElement.bind(document)
    const anchor = originalCreateElement('a') as HTMLAnchorElement
    const clickSpy = vi.spyOn(anchor, 'click').mockImplementation(vi.fn())
    const createElementSpy = vi.spyOn(document, 'createElement')
      .mockImplementation((tagName: Parameters<Document['createElement']>[0]) => {
        if (tagName === 'a')
          return anchor
        return originalCreateElement(tagName)
      })
    let capturedBlob: Blob | null = null
    const objectURLSpy = vi.spyOn(URL, 'createObjectURL')
      .mockImplementation((blob) => {
        capturedBlob = blob as Blob
        return 'blob://mock-url'
      })
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(vi.fn())

    renderComponent({}, LanguagesSupported[1])

    await expandExportMenu(user)

    await waitFor(() => expect(mockCSVDownloader).toHaveBeenCalled())

    const { jsonButton } = await getExportButtons()
    await user.click(jsonButton)

    expect(createElementSpy).toHaveBeenCalled()
    expect(anchor.download).toBe(`annotations-${LanguagesSupported[1]}.jsonl`)
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeSpy).toHaveBeenCalledWith('blob://mock-url')

    // Verify the blob was created with correct content
    expect(capturedBlob).toBeInstanceOf(Blob)
    expect(capturedBlob!.type).toBe('application/jsonl')

    const blobContent = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsText(capturedBlob!)
    })
    const lines = blobContent.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({
      messages: [
        { role: 'system', content: '' },
        { role: 'user', content: 'Question 1' },
        { role: 'assistant', content: 'Answer 1' },
      ],
    })

    clickSpy.mockRestore()
    createElementSpy.mockRestore()
    objectURLSpy.mockRestore()
    revokeSpy.mockRestore()
  })

  it('should clear all annotations when confirmation succeeds', async () => {
    mockedClearAllAnnotations.mockResolvedValue(undefined)
    const user = userEvent.setup()
    const onAdded = vi.fn()
    renderComponent({ onAdded })

    await openOperationsPopover(user)
    await clickOperationAction(user, 'appAnnotation.table.header.clearAll')

    await screen.findByText('appAnnotation.table.header.clearAllConfirm')
    const confirmButton = screen.getByRole('button', { name: 'common.operation.confirm' })
    await user.click(confirmButton)

    await waitFor(() => {
      expect(mockedClearAllAnnotations).toHaveBeenCalledWith('test-app-id')
      expect(onAdded).toHaveBeenCalled()
    })
  })

  it('should handle clear all failures gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn())
    mockedClearAllAnnotations.mockRejectedValue(new Error('network'))
    const user = userEvent.setup()
    const onAdded = vi.fn()
    renderComponent({ onAdded })

    await openOperationsPopover(user)
    await clickOperationAction(user, 'appAnnotation.table.header.clearAll')
    await screen.findByText('appAnnotation.table.header.clearAllConfirm')
    const confirmButton = screen.getByRole('button', { name: 'common.operation.confirm' })
    await user.click(confirmButton)

    await waitFor(() => {
      expect(mockedClearAllAnnotations).toHaveBeenCalled()
      expect(onAdded).not.toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalled()
    })

    consoleSpy.mockRestore()
  })

  it('should refetch annotations when controlUpdateList changes', async () => {
    const view = renderComponent({ controlUpdateList: 0 })

    await waitFor(() => expect(mockedFetchAnnotations).toHaveBeenCalledTimes(1))

    view.rerender(
      <HeaderOptions
        appId="test-app-id"
        onAdd={vi.fn()}
        onAdded={vi.fn()}
        controlUpdateList={1}
      />,
    )

    await waitFor(() => expect(mockedFetchAnnotations).toHaveBeenCalledTimes(2))
  })
})

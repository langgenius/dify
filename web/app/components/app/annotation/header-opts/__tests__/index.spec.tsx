/* eslint-disable ts/no-explicit-any */
import type { ComponentProps } from 'react'
import type { Mock } from 'vitest'
import type { AnnotationItemBasic } from '../../type'
import type { Locale } from '@/i18n-config'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocale } from '@/context/i18n'
import { LanguagesSupported } from '@/i18n-config/language'
import { clearAllAnnotations, fetchExportAnnotationList } from '@/service/annotation'
import HeaderOptions from '../index'

const mockJsonToCSV = vi.fn((_: unknown) => 'csv-content')
const mockCSVDownloader = vi.fn(({ children }) => <>{children}</>)

vi.mock('react-papaparse', () => ({
  useCSVDownloader: () => ({
    CSVDownloader: (props: any) => mockCSVDownloader(props),
    Type: { Link: 'link' },
  }),
  jsonToCSV: (data: unknown) => mockJsonToCSV(data),
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
  locale: Locale = LanguagesSupported[0]!,
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
  const trigger = screen.getByRole('button', { name: 'common.operation.more' }) as HTMLButtonElement
  await user.click(trigger)
}

const expandExportMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await openOperationsPopover(user)
  const exportItem = await screen.findByRole('menuitem', { name: /appAnnotation\.table\.header\.bulkExport/i })
  await user.hover(exportItem)
}

const getExportItems = async () => {
  const csvItem = await screen.findByRole('menuitem', { name: 'CSV' })
  const jsonItem = await screen.findByRole('menuitem', { name: 'JSONL' })
  return {
    csvItem,
    jsonItem,
  }
}

const clickMenuItem = async (item: HTMLElement) => {
  await act(async () => {
    item.click()
  })
}

const clickOperationAction = async (translationKey: string) => {
  const item = await screen.findByRole('menuitem', { name: translationKey })
  await clickMenuItem(item)
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
    mockJsonToCSV.mockReturnValue('csv-content')
    mockedFetchAnnotations.mockResolvedValue({ data: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should fetch annotations on mount and render enabled export actions when data exist', async () => {
    mockedFetchAnnotations.mockResolvedValue({ data: mockAnnotations })
    const user = userEvent.setup()
    renderComponent()

    await waitFor(() => {
      expect(mockedFetchAnnotations).toHaveBeenCalledWith('test-app-id')
    })

    await expandExportMenu(user)

    const { csvItem, jsonItem } = await getExportItems()

    expect(csvItem).not.toHaveAttribute('data-disabled')
    expect(jsonItem).not.toHaveAttribute('data-disabled')

    await clickMenuItem(csvItem)

    expect(mockJsonToCSV).toHaveBeenCalledWith([
      ['Question', 'Answer'],
      ['Question 1', 'Answer 1'],
    ])
  })

  it('should trigger CSV download with locale-specific filename', async () => {
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

    const { csvItem } = await getExportItems()
    await clickMenuItem(csvItem)

    expect(mockJsonToCSV).toHaveBeenCalledWith([
      ['问题', '答案'],
      ['Question 1', 'Answer 1'],
    ])
    expect(createElementSpy).toHaveBeenCalled()
    expect(anchor.download).toBe(`annotations-${LanguagesSupported[1]}.csv`)
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeSpy).toHaveBeenCalledWith('blob://mock-url')

    expect(capturedBlob).toBeInstanceOf(Blob)
    expect(capturedBlob!.type).toBe('text/csv;charset=utf-8;')

    const blobContent = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsText(capturedBlob!)
    })
    expect(blobContent).toBe('csv-content')

    clickSpy.mockRestore()
    createElementSpy.mockRestore()
    objectURLSpy.mockRestore()
    revokeSpy.mockRestore()
  })

  it('should disable export actions when there are no annotations', async () => {
    const user = userEvent.setup()
    renderComponent()

    await expandExportMenu(user)

    const { csvItem, jsonItem } = await getExportItems()

    expect(csvItem).toHaveAttribute('data-disabled')
    expect(jsonItem).toHaveAttribute('data-disabled')
    expect(mockJsonToCSV).not.toHaveBeenCalled()
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
    await clickOperationAction('appAnnotation.table.header.bulkImport')

    expect(await screen.findByText('appAnnotation.batchModal.title'))!.toBeInTheDocument()
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

    const { jsonItem } = await getExportItems()
    await clickMenuItem(jsonItem)

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
    expect(JSON.parse(lines[0]!)).toEqual({
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
    await clickOperationAction('appAnnotation.table.header.clearAll')

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
    await clickOperationAction('appAnnotation.table.header.clearAll')
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

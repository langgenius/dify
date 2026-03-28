import type { ComponentProps } from 'react'
import type { PromptConfig, SavedMessage } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { VisionSettings } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import { Resolution, TransferMethod } from '@/types/app'
import { defaultSystemFeatures } from '@/types/feature'
import TextGenerationSidebar from '../text-generation-sidebar'

const runOncePropsSpy = vi.fn()
const runBatchPropsSpy = vi.fn()
const savedItemsPropsSpy = vi.fn()

vi.mock('@/app/components/share/text-generation/run-once', () => ({
  default: (props: Record<string, unknown>) => {
    runOncePropsSpy(props)
    return <div data-testid="run-once-mock" />
  },
}))

vi.mock('@/app/components/share/text-generation/run-batch', () => ({
  default: (props: Record<string, unknown>) => {
    runBatchPropsSpy(props)
    return <div data-testid="run-batch-mock" />
  },
}))

vi.mock('@/app/components/app/text-generate/saved-items', () => ({
  default: (props: { onStartCreateContent: () => void, list: Array<{ id: string }> }) => {
    savedItemsPropsSpy(props)
    return (
      <div data-testid="saved-items-mock">
        <span>{props.list.length}</span>
        <button onClick={props.onStartCreateContent}>back-to-create</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/share/text-generation/menu-dropdown', () => ({
  default: () => <div data-testid="menu-dropdown-mock" />,
}))

const promptConfig: PromptConfig = {
  prompt_template: 'template',
  prompt_variables: [
    { key: 'name', name: 'Name', type: 'string', required: true },
  ],
}

const savedMessages: SavedMessage[] = [
  { id: 'saved-1', answer: 'Answer 1' },
  { id: 'saved-2', answer: 'Answer 2' },
]

const siteInfo: SiteInfo = {
  title: 'Text Generation',
  description: 'Share description',
  icon_type: 'emoji',
  icon: 'robot',
  icon_background: '#fff',
  icon_url: '',
}

const visionConfig: VisionSettings = {
  enabled: false,
  number_limits: 2,
  detail: Resolution.low,
  transfer_methods: [TransferMethod.local_file],
}

const baseProps: ComponentProps<typeof TextGenerationSidebar> = {
  accessMode: AccessMode.PUBLIC,
  allTasksRun: true,
  currentTab: 'create',
  customConfig: {
    remove_webapp_brand: false,
    replace_webapp_logo: '',
  },
  inputs: { name: 'Alice' },
  inputsRef: { current: { name: 'Alice' } },
  isInstalledApp: false,
  isPC: true,
  isWorkflow: false,
  onBatchSend: vi.fn(),
  onInputsChange: vi.fn(),
  onRemoveSavedMessage: vi.fn(async () => {}),
  onRunOnceSend: vi.fn(),
  onTabChange: vi.fn(),
  onVisionFilesChange: vi.fn(),
  promptConfig,
  resultExisted: false,
  runControl: null,
  savedMessages,
  siteInfo,
  systemFeatures: defaultSystemFeatures,
  textToSpeechConfig: { enabled: true },
  visionConfig,
}

const renderSidebar = (overrides: Partial<typeof baseProps> = {}) => {
  return render(<TextGenerationSidebar {...baseProps} {...overrides} />)
}

describe('TextGenerationSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render create tab content and pass orchestration props to RunOnce', () => {
    renderSidebar()

    expect(screen.getByText('Text Generation')).toBeInTheDocument()
    expect(screen.getByText('Share description')).toBeInTheDocument()
    expect(screen.getByTestId('run-once-mock')).toBeInTheDocument()
    expect(runOncePropsSpy).toHaveBeenCalledWith(expect.objectContaining({
      inputs: { name: 'Alice' },
      promptConfig,
      runControl: null,
      visionConfig,
    }))
    expect(screen.queryByTestId('saved-items-mock')).not.toBeInTheDocument()
  })

  it('should render batch tab and hide saved tab for workflow apps', () => {
    renderSidebar({
      currentTab: 'batch',
      isWorkflow: true,
    })

    expect(screen.getByTestId('run-batch-mock')).toBeInTheDocument()
    expect(runBatchPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
      vars: promptConfig.prompt_variables,
      isAllFinished: true,
    }))
    expect(screen.queryByTestId('tab-header-item-saved')).not.toBeInTheDocument()
  })

  it('should render saved items and allow switching back to create tab', () => {
    const onTabChange = vi.fn()

    renderSidebar({
      currentTab: 'saved',
      onTabChange,
    })

    expect(screen.getByTestId('saved-items-mock')).toBeInTheDocument()
    expect(savedItemsPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
      list: baseProps.savedMessages,
      isShowTextToSpeech: true,
    }))

    fireEvent.click(screen.getByRole('button', { name: 'back-to-create' }))
    expect(onTabChange).toHaveBeenCalledWith('create')
  })

  it('should prefer workspace branding and hide powered-by block when branding is removed', () => {
    const { rerender } = renderSidebar({
      systemFeatures: {
        ...defaultSystemFeatures,
        branding: {
          ...defaultSystemFeatures.branding,
          enabled: true,
          workspace_logo: 'https://example.com/workspace-logo.png',
        },
      },
    })

    const brandingLogo = screen.getByRole('img', { name: 'logo' })
    expect(brandingLogo).toHaveAttribute('src', 'https://example.com/workspace-logo.png')

    rerender(
      <TextGenerationSidebar
        {...baseProps}
        customConfig={{
          remove_webapp_brand: true,
          replace_webapp_logo: '',
        }}
      />,
    )

    expect(screen.queryByText('share.chat.poweredBy')).not.toBeInTheDocument()
  })

  it('should render mobile installed-app layout without saved badge when no saved messages exist', () => {
    const { container } = renderSidebar({
      accessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
      isInstalledApp: true,
      isPC: false,
      resultExisted: false,
      savedMessages: [],
      siteInfo: {
        ...siteInfo,
        description: '',
        icon_background: '',
      },
    })

    const root = container.firstElementChild as HTMLElement
    const header = root.children[0] as HTMLElement
    const body = root.children[1] as HTMLElement

    expect(root).toHaveClass('rounded-l-2xl')
    expect(root).not.toHaveClass('h-[calc(100%_-_64px)]')
    expect(header).toHaveClass('p-4', 'pb-0')
    expect(body).toHaveClass('px-4')
    expect(screen.queryByText('Share description')).not.toBeInTheDocument()
  })

  it('should render mobile saved tab with compact spacing and no text-to-speech flag', () => {
    const { container } = renderSidebar({
      accessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
      currentTab: 'saved',
      isPC: false,
      resultExisted: true,
      textToSpeechConfig: null,
    })

    const root = container.firstElementChild as HTMLElement
    const body = root.children[1] as HTMLElement
    const footer = root.children[2] as HTMLElement

    expect(root).toHaveClass('h-[calc(100%_-_64px)]')
    expect(body).toHaveClass('px-4')
    expect(footer).toHaveClass('px-4', 'rounded-b-2xl')
    expect(savedItemsPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
      className: expect.stringContaining('mt-4'),
      isShowTextToSpeech: undefined,
    }))
  })

  it('should round the mobile panel body and hide branding when the webapp brand is removed', () => {
    const { container } = renderSidebar({
      isPC: false,
      resultExisted: true,
      customConfig: {
        remove_webapp_brand: true,
        replace_webapp_logo: '',
      },
    })

    const root = container.firstElementChild as HTMLElement
    const body = root.children[1] as HTMLElement

    expect(body).toHaveClass('rounded-b-2xl')
    expect(screen.queryByText('share.chat.poweredBy')).not.toBeInTheDocument()
  })

  it('should render the custom webapp logo when workspace branding is unavailable', () => {
    renderSidebar({
      customConfig: {
        remove_webapp_brand: false,
        replace_webapp_logo: 'https://example.com/custom-logo.png',
      },
    })

    const brandingLogo = screen.getByRole('img', { name: 'logo' })
    expect(brandingLogo).toHaveAttribute('src', 'https://example.com/custom-logo.png')
  })
})

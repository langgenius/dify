import type { ComponentProps } from 'react'
import type { PromptConfig, SavedMessage } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { VisionSettings } from '@/types/app'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { AccessMode } from '@/models/access-control'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { Resolution, TransferMethod } from '@/types/app'
import TextGenerationSidebar from '../text-generation-sidebar'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
  useParams: () => ({}),
}))

const promptConfig: PromptConfig = {
  prompt_template: 'template',
  prompt_variables: [
    { key: 'name', name: 'Name', type: 'string', required: true, default: 'Alice' },
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
  systemFeatures: createSystemFeaturesFixture(),
  textToSpeechConfig: { enabled: true },
  visionConfig,
}

const renderSidebar = (overrides: Partial<typeof baseProps> = {}) => {
  function Caller() {
    const [currentTab, setCurrentTab] = useState(overrides.currentTab ?? baseProps.currentTab)
    const [inputs, setInputs] = useState(baseProps.inputs)
    const inputsRef = useRef(inputs)
    const [savedMessages, setSavedMessages] = useState(baseProps.savedMessages)
    return (
      <TextGenerationSidebar
        {...baseProps}
        {...overrides}
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        inputs={inputs}
        inputsRef={inputsRef}
        onInputsChange={setInputs}
        savedMessages={savedMessages}
        onRemoveSavedMessage={async (id) =>
          setSavedMessages((messages) => messages.filter((message) => message.id !== id))
        }
      />
    )
  }
  return render(<Caller />)
}

describe('TextGenerationSidebar', () => {
  it('renders the create form with its configured input', () => {
    renderSidebar()

    expect(screen.getByText('Text Generation')).toBeInTheDocument()
    expect(screen.getByText('Share description')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Alice')
    expect(screen.getByRole('button', { name: 'share.generation.run' })).toBeEnabled()
    expect(screen.queryByText('Answer 1')).not.toBeInTheDocument()
  })

  it('renders the batch uploader and hides saved content for workflow apps', () => {
    renderSidebar({ currentTab: 'batch', isWorkflow: true })

    expect(screen.getByText('share.generation.csvUploadTitle')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'share.generation.run' })).toBeDisabled()
    expect(
      screen.queryByRole('tab', { name: /^share\.generation\.tabs\.saved/ }),
    ).not.toBeInTheDocument()
  })

  it('renders saved answers and switches back to the real create form', async () => {
    const user = userEvent.setup()
    renderSidebar({ currentTab: 'saved' })

    expect(await screen.findByText('Answer 1')).toBeInTheDocument()
    expect(screen.getByText('Answer 2')).toBeInTheDocument()
    for (const button of screen.getAllByRole('button', { name: 'common.operation.delete' }))
      await user.click(button)
    expect(screen.getByText('share.generation.savedNoData.title')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'share.generation.savedNoData.startCreateContent' }),
    )
    expect(screen.getByRole('tab', { name: 'share.generation.tabs.create' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Alice')
    expect(screen.queryByText('Answer 1')).not.toBeInTheDocument()
  })

  it('should prefer workspace branding and hide powered-by block when branding is removed', () => {
    const { rerender } = renderSidebar({
      systemFeatures: createSystemFeaturesFixture({
        branding: {
          enabled: true,
          workspace_logo: 'https://example.com/workspace-logo.png',
        },
      }),
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

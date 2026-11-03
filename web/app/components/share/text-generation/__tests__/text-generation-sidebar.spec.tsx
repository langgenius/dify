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
import SignIn from '../../sign-in'
import { getWebAppEntryState, WebAppEntryContext } from '../../webapp-entry'
import TextGenerationSidebar from '../text-generation-sidebar'

vi.mock('@/app/components/share/text-generation/text-generation-menu', () => ({
  default: () => <button type="button">Account menu</button>,
}))

vi.mock('@/app/components/share/connections/webapp-connection-controls', () => ({
  default: ({ showSignIn = true }: { showSignIn?: boolean }) => (
    <>
      {showSignIn && <SignIn />}
      <button type="button">Configure connections</button>
    </>
  ),
}))

vi.mock('@/app/components/share/use-webapp-sign-in', () => ({
  default: () => ({ signIn: vi.fn(), pending: false, error: null }),
}))

vi.mock('@/app/components/share/connections/webapp-connection-setup', () => ({
  default: ({ onStart }: { onStart: () => void }) => (
    <button type="button" onClick={onStart}>
      Start using app
    </button>
  ),
}))

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

const entryParameters = {
  account_login_enabled: true,
  account_login_url: 'https://accounts.example/signin',
  allow_anonymous_end_user_auth: true,
  connection_revision: null,
  requires_end_user_connections: false,
  connection_requirements: [],
}

const authenticatedEntry = getWebAppEntryState({
  parameters: entryParameters,
  loginStatus: { logged_in: true, app_logged_in: true },
  canAccess: true,
  appDataReady: true,
  hasError: false,
})

const createAnonymousEntry = (parameters: Partial<typeof entryParameters> = {}) =>
  getWebAppEntryState({
    parameters: { ...entryParameters, ...parameters },
    loginStatus: { logged_in: false, app_logged_in: true },
    canAccess: true,
    appDataReady: true,
    hasError: false,
  })

const renderWorkflow = (overrides: Partial<typeof baseProps> = {}, entry = authenticatedEntry) => {
  return render(
    <WebAppEntryContext value={entry}>
      <TextGenerationSidebar {...baseProps} isWorkflow {...overrides} />
    </WebAppEntryContext>,
  )
}

describe('TextGenerationSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    { isWorkflow: true, isPC: true },
    { isWorkflow: true, isPC: false },
    { isWorkflow: false, isPC: true },
    { isWorkflow: false, isPC: false },
  ])(
    'offers My apps before application information for the authenticated Webapp: %o',
    (surface) => {
      renderWorkflow(surface)

      const myApps = screen.getByRole('link', { name: 'app.endUser.myApps' })
      expect(myApps).toHaveAttribute('href', '/my-apps')
      expect(
        myApps.compareDocumentPosition(screen.getByText('Text Generation')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    },
  )

  it.each([false, true])(
    'does not offer My apps for an anonymous Webapp, workflow=%s',
    (isWorkflow) => {
      renderWorkflow({ isWorkflow }, createAnonymousEntry())

      expect(screen.queryByRole('link', { name: 'app.endUser.myApps' })).not.toBeInTheDocument()
    },
  )

  it.each([false, true])(
    'does not offer Webapp My apps navigation for an installed app, workflow=%s',
    (isWorkflow) => {
      renderWorkflow({ isWorkflow, isInstalledApp: true })

      expect(screen.queryByRole('link', { name: 'app.endUser.myApps' })).not.toBeInTheDocument()
    },
  )

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

  it('keeps workflow tabs available without input variables while configuring connections', async () => {
    const user = userEvent.setup()
    const onStartUsingApp = vi.fn()
    renderWorkflow({
      isConfiguringConnections: true,
      onStartUsingApp,
      promptConfig: { ...promptConfig, prompt_variables: [] },
    })

    expect(screen.getByRole('tab', { name: 'share.generation.tabs.create' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'share.generation.tabs.batch' })).toBeVisible()
    expect(
      screen.queryByRole('tab', { name: /^share\.generation\.tabs\.saved/ }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configure connections' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'share.generation.run' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Start using app' }))
    expect(onStartUsingApp).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    'keeps the workflow account menu after run content when branding is removed: %s',
    (removeBrand) => {
      renderWorkflow({
        customConfig: { remove_webapp_brand: removeBrand, replace_webapp_logo: '' },
      })

      const runContent = screen.getByRole('button', { name: 'share.generation.run' })
      const accountMenu = screen.getByRole('button', { name: 'Account menu' })
      expect(
        runContent.compareDocumentPosition(accountMenu) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(accountMenu).toBeVisible()
      expect(screen.getByRole('button', { name: 'Configure connections' })).toBeVisible()
      if (removeBrand) expect(screen.queryByText('share.chat.poweredBy')).not.toBeInTheDocument()
      else expect(screen.getByText('share.chat.poweredBy')).toBeVisible()
    },
  )

  it.each([
    { isWorkflow: false, isInstalledApp: false },
    { isWorkflow: true, isInstalledApp: true },
  ])('keeps the account menu before run content for legacy surfaces: %o', (surface) => {
    renderWorkflow(surface)

    const accountMenu = screen.getByRole('button', { name: 'Account menu' })
    expect(
      accountMenu.compareDocumentPosition(
        screen.getByRole('button', { name: 'share.generation.run' }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('offers one anonymous sign-in action after workflow content', () => {
    renderWorkflow({}, createAnonymousEntry())

    const signIn = screen.getByRole('button', { name: 'share.auth.signIn' })
    expect(signIn).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'share.generation.run' }).compareDocumentPosition(signIn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
  })

  it('keeps anonymous workflow tabs and footer sign-in available during required connection setup without variables', () => {
    renderWorkflow(
      {
        isConfiguringConnections: true,
        onStartUsingApp: vi.fn(),
        promptConfig: { ...promptConfig, prompt_variables: [] },
      },
      createAnonymousEntry({ requires_end_user_connections: true }),
    )

    expect(screen.getByRole('tab', { name: 'share.generation.tabs.create' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'share.generation.tabs.batch' })).toBeVisible()
    const signIn = screen.getByRole('button', { name: 'share.auth.signIn' })
    expect(signIn).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Start using app' }).compareDocumentPosition(signIn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Configure connections' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
  })

  it('does not offer sign-in for an anonymous workflow with account login disabled', () => {
    renderWorkflow({}, createAnonymousEntry({ account_login_enabled: false }))

    expect(screen.queryByRole('button', { name: 'share.auth.signIn' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'share.generation.tabs.create' })).toBeVisible()
  })
})

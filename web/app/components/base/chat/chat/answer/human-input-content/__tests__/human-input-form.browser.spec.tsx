import type { HumanInputFormData } from '@/types/workflow'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { TransferMethod } from '@/types/app'
import HumanInputForm from '../human-input-form'
import { UnsubmittedHumanInputContent } from '../unsubmitted'

// oxlint-disable-next-line typescript/no-deprecated -- The production file picker still uses the XHR upload transport.
const upload = vi.hoisted(() => vi.fn<typeof import('@/service/base').upload>())

vi.mock('@/service/base', () => ({ upload }))
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))

const currentTimestamp = Math.floor(Date.now() / 1000)

const formData = (overrides: Partial<HumanInputFormData> = {}): HumanInputFormData => ({
  form_id: 'form-1',
  node_id: 'node-1',
  node_title: 'Approval',
  display_in_ui: true,
  expiration_time: currentTimestamp + 3600,
  form_token: 'token-1',
  form_content: 'Read the [policy](https://example.com/policy) {{#$output.summary#}}',
  inputs: [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'summary',
      default: { type: 'constant', value: 'Initial response', selector: [] },
    },
  ],
  actions: [
    { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
    { id: 'reject', title: 'Reject', button_style: UserActionButtonType.Default },
  ],
  resolved_default_values: {},
  ...overrides,
})

async function renderWithQueries(ui: React.ReactElement) {
  const { wrapper: Query } = createConsoleQueryWrapper({
    accountProfile: { email: 'reviewer@example.com' },
  })
  return render(<Query>{ui}</Query>)
}

beforeEach(() => {
  upload.mockReset().mockImplementation(async ({ data }) => ({
    id: `uploaded-${(data.get('file') as File).name}`,
  }))
  onTestFinished(guardUnexpectedFetch())
})

it('submits the visible form values and keeps them available after a failed attempt', async () => {
  const firstAttempt = createDeferred<void>()
  const onSubmit = vi
    .fn()
    .mockReturnValueOnce(firstAttempt.promise)
    .mockResolvedValueOnce(undefined)
  await renderWithQueries(<HumanInputForm formData={formData()} onSubmit={onSubmit} />)

  await expect
    .element(page.getByRole('link', { name: 'policy' }))
    .toHaveAttribute('href', 'https://example.com/policy')
  const response = page.getByRole('textbox', { name: 'summary' })
  await response.fill('Approve after legal review')
  const approve = page.getByRole('button', { name: 'Approve' })
  const reject = page.getByRole('button', { name: 'Reject' })
  await approve.click()

  await expect.element(approve).toBeDisabled()
  await expect.element(reject).toBeDisabled()
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith('token-1', {
    action: 'approve',
    inputs: { summary: 'Approve after legal review' },
    form_version: undefined,
  })

  firstAttempt.reject(new Error('Request failed'))
  await expect.element(approve).toBeEnabled()
  await expect.element(response).toHaveValue('Approve after legal review')
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()

  await approve.click()
  await expect.poll(() => onSubmit.mock.calls.length).toBe(2)
  expect(onSubmit).toHaveBeenLastCalledWith('token-1', {
    action: 'approve',
    inputs: { summary: 'Approve after legal review' },
    form_version: undefined,
  })
})

it('waits for every rendered select and file upload before enabling submission', async () => {
  const singleUpload = createDeferred<{ id: string }>()
  const listUpload = createDeferred<{ id: string }>()
  upload.mockImplementation(({ data }) => {
    const file = data.get('file') as File
    return file.name === 'main.png' ? singleUpload.promise : listUpload.promise
  })
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  await renderWithQueries(
    <HumanInputForm
      formData={formData({
        form_content: '{{#$output.decision#}} {{#$output.evidence#}} {{#$output.main#}}',
        inputs: [
          {
            type: InputVarType.select,
            output_variable_name: 'decision',
            option_source: { type: 'constant', value: ['approved'], selector: [] },
          },
          {
            type: InputVarType.multiFiles,
            output_variable_name: 'evidence',
            allowed_file_extensions: ['.png'],
            allowed_file_types: [SupportUploadFileTypes.image],
            allowed_file_upload_methods: [TransferMethod.local_file],
            number_limits: 5,
          },
          {
            type: InputVarType.singleFile,
            output_variable_name: 'main',
            allowed_file_extensions: ['.png'],
            allowed_file_types: [SupportUploadFileTypes.image],
            allowed_file_upload_methods: [TransferMethod.local_file],
          },
        ],
      })}
      onSubmit={onSubmit}
    />,
  )

  const approve = page.getByRole('button', { name: 'Approve' })
  await expect.element(approve).toBeDisabled()
  await page.getByRole('combobox', { name: 'decision' }).click()
  await page.getByRole('option', { name: 'approved' }).click()

  const singleInput = page.elementLocator(
    document.querySelector<HTMLInputElement>('input[type="file"]:not([multiple])')!,
  )
  const listInput = page.elementLocator(
    document.querySelector<HTMLInputElement>('input[type="file"][multiple]')!,
  )
  await singleInput.upload(new File(['main'], 'main.png', { type: 'image/png' }))
  await listInput.upload(new File(['evidence'], 'evidence.png', { type: 'image/png' }))
  await expect.element(page.getByText('main.png')).toBeVisible()
  await expect.element(page.getByText('evidence.png')).toBeVisible()
  await expect.element(approve).toBeDisabled()
  expect(onSubmit).not.toHaveBeenCalled()

  listUpload.resolve({ id: 'uploaded-evidence' })
  await expect.element(approve).toBeDisabled()
  singleUpload.resolve({ id: 'uploaded-main' })
  await expect.element(approve).toBeEnabled()
  await approve.click()

  expect(onSubmit).toHaveBeenCalledExactlyOnceWith('token-1', {
    action: 'approve',
    form_version: undefined,
    inputs: {
      decision: 'approved',
      evidence: [
        {
          type: 'image',
          transfer_method: TransferMethod.local_file,
          url: '',
          upload_file_id: 'uploaded-evidence',
        },
      ],
      main: {
        type: 'image',
        transfer_method: TransferMethod.local_file,
        url: '',
        upload_file_id: 'uploaded-main',
      },
    },
  })
})

it('updates the visible delivery guidance and expiration state through owner props', async () => {
  function GuidanceOwner() {
    const [debug, setDebug] = useState(false)
    const [expired, setExpired] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setDebug(true)}>
          Use debug delivery
        </button>
        <button type="button" onClick={() => setExpired(true)}>
          Expire approval
        </button>
        <UnsubmittedHumanInputContent
          formData={formData({
            expiration_time: currentTimestamp + (expired ? -3600 : 3600),
          })}
          showEmailTip
          isEmailDebugMode={debug}
          showDebugModeTip
          onSubmit={vi.fn()}
        />
      </>
    )
  }
  await renderWithQueries(<GuidanceOwner />)

  await expect.element(page.getByText('workflow.common.humanInputEmailTip')).toBeVisible()
  await expect.element(page.getByText('workflow.common.humanInputWebappTip')).toBeVisible()
  await expect.element(page.getByText(/share\.humanInput\.expirationTimeNowOrFuture/)).toBeVisible()

  await page.getByRole('button', { name: 'Use debug delivery' }).click()
  await expect
    .element(page.getByText('workflow.common.humanInputEmailTipInDebugMode'))
    .toBeVisible()
  await expect.element(page.getByText('workflow.common.humanInputEmailTip')).not.toBeInTheDocument()

  await page.getByRole('button', { name: 'Expire approval' }).click()
  await expect.element(page.getByText('share.humanInput.expiredTip')).toBeVisible()
  await expect
    .element(page.getByText(/share\.humanInput\.expirationTimeNowOrFuture/))
    .not.toBeInTheDocument()
})

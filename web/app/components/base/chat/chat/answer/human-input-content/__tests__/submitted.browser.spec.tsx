import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { FileResponse, HumanInputFilledFormData } from '@/types/workflow'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { InputVarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { SubmittedHumanInputContent } from '../submitted'

const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

const attachment: FileResponse = {
  related_id: 'file-1',
  upload_file_id: 'upload-1',
  filename: 'decision.pdf',
  extension: 'pdf',
  size: 128,
  mime_type: 'application/pdf',
  transfer_method: TransferMethod.local_file,
  type: 'document',
  url: 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK',
  remote_url: '',
}

const evidence: FileResponse[] = [
  {
    related_id: 'file-2',
    upload_file_id: 'upload-2',
    filename: 'evidence.gif',
    extension: 'gif',
    size: 43,
    mime_type: 'image/gif',
    transfer_method: TransferMethod.remote_url,
    type: 'image',
    url: pixel,
    remote_url: pixel,
  },
  {
    related_id: 'file-3',
    upload_file_id: 'upload-3',
    filename: 'evidence.pdf',
    extension: 'pdf',
    size: 512,
    mime_type: 'application/pdf',
    transfer_method: TransferMethod.local_file,
    type: 'document',
    url: 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK',
    remote_url: '',
  },
]

const fields: FormInputItem[] = [
  {
    type: InputVarType.paragraph,
    output_variable_name: 'summary',
    default: { type: 'constant', value: '', selector: [] },
  },
  {
    type: InputVarType.select,
    output_variable_name: 'decision',
    option_source: { type: 'constant', value: ['approve', 'reject'], selector: [] },
  },
  {
    type: InputVarType.singleFile,
    output_variable_name: 'attachment',
    allowed_file_extensions: [],
    allowed_file_types: [],
    allowed_file_upload_methods: [],
  },
  {
    type: InputVarType.multiFiles,
    output_variable_name: 'evidence',
    allowed_file_extensions: [],
    allowed_file_types: [],
    allowed_file_upload_methods: [],
    number_limits: 5,
  },
]

const baseForm: HumanInputFilledFormData = {
  form_id: 'form-1',
  rendered_content: 'Rendered [Markdown](https://example.com/submitted) content',
  action_id: 'approve',
  action_text: 'Approve',
  node_id: 'node-1',
  node_title: 'Approval',
}

it('renders submitted values in their original readonly form layout', async () => {
  await render(
    <SubmittedHumanInputContent
      formData={{
        ...baseForm,
        form_content:
          'Summary: {{#$output.summary#}} {{#$output.decision#}} {{#$output.attachment#}} {{#$output.evidence#}}',
        inputs: fields,
        submitted_data: {
          summary: 'Approved after review',
          decision: 'approve',
          attachment,
          evidence,
        },
      }}
    />,
  )

  await expect.element(page.getByText('Approved after review')).toBeVisible()
  const decision = page.getByRole('combobox', { name: 'decision' })
  await expect.element(decision).toBeDisabled()
  await expect.element(decision).toHaveTextContent('approve')
  await expect.element(page.getByText('decision.pdf')).toBeVisible()
  await expect.element(page.getByText('evidence.pdf')).toBeVisible()
  await expect.element(page.getByRole('img', { name: 'Preview' })).toHaveAttribute('src', pixel)
  await expect.element(page.getByText('Markdown')).not.toBeInTheDocument()
  await expect
    .element(page.getByText('workflowHumanInput.nodes.humanInput.userActions.triggered'))
    .toBeVisible()
})

it('falls back to the rendered Markdown link when no submitted values exist', async () => {
  await render(<SubmittedHumanInputContent formData={baseForm} />)

  await expect
    .element(page.getByRole('link', { name: 'Markdown' }))
    .toHaveAttribute('href', 'https://example.com/submitted')
  await expect
    .element(page.getByText('workflowHumanInput.nodes.humanInput.userActions.triggered'))
    .toBeVisible()
})

it('renders typed submitted values even when the original form layout is unavailable', async () => {
  await render(
    <SubmittedHumanInputContent
      formData={{
        ...baseForm,
        submitted_data: {
          summary: 'Unstructured summary',
          attachment,
          evidence,
        },
      }}
    />,
  )

  await expect.element(page.getByText('Unstructured summary')).toBeVisible()
  await expect.element(page.getByText('decision.pdf')).toBeVisible()
  await expect.element(page.getByText('evidence.pdf')).toBeVisible()
  await expect.element(page.getByRole('img', { name: 'Preview' })).toHaveAttribute('src', pixel)
  await expect.element(page.getByText('Markdown')).not.toBeInTheDocument()
})

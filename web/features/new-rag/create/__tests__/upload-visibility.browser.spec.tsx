import type { NewKnowledgeStartMode } from '../../routes'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { StartMode } from '../components/dialog-parts'
import { CreateUploadQueue } from '../upload-queue'

vi.mock('../../upload/plan-notice', () => ({ DocumentUploadPlanNotice: () => null }))

function ScrollableCreationModes() {
  const [mode, setMode] = useState<NewKnowledgeStartMode>('empty')

  return (
    <section aria-label="Creation dialog" className="w-80 overflow-hidden">
      <h1>Create knowledge</h1>
      <section aria-label="Creation form" className="h-48 overflow-y-auto">
        <div className="h-80" />
        <RadioGroup value={mode} onValueChange={setMode} className="flex-col items-stretch">
          <StartMode
            value="empty"
            selected={mode === 'empty'}
            icon="i-ri-folder-6-line"
            title="Start empty"
            description="Add content later"
          />
          <StartMode
            value="upload"
            selected={mode === 'upload'}
            icon="i-ri-file-text-line"
            title="Upload files"
            description="Add files from your computer"
          >
            <CreateUploadQueue
              disabled={false}
              fileSizeLimitMb={15}
              supportBatchUpload
              uploading={false}
              uploads={[]}
              onChange={vi.fn()}
            />
          </StartMode>
        </RadioGroup>
      </section>
      <button type="button">Create</button>
    </section>
  )
}

it('reveals the entire upload drop zone on expansion without moving the panel or stealing focus', async () => {
  // Real scrolling catches the expanded drop zone remaining clipped below the form viewport;
  // DOM visibility assertions alone pass even when its lower edge cannot be seen.
  await page.viewport(400, 600)
  const screen = await render(<ScrollableCreationModes />)
  const heading = screen.getByRole('heading', { name: 'Create knowledge' }).element()
  const submit = screen.getByRole('button', { name: 'Create', exact: true }).element()
  const headingTop = heading.getBoundingClientRect().top
  const submitTop = submit.getBoundingClientRect().top
  const form = screen.getByRole('region', { name: 'Creation form' }).element()
  const upload = screen.getByRole('radio', { name: 'Upload files' })

  for (let attempt = 0; attempt < 2; attempt++) {
    await upload.click()
    await expect.element(upload).toBeChecked()
    await expect.element(upload).toHaveFocus()
    const input = screen.getByLabelText('knowledgeSpace.uploadFiles').element() as HTMLInputElement
    const dropzone = input.labels?.[0]
    if (!dropzone) throw new Error('Upload input must have an associated drop zone label')
    await expect
      .poll(() => {
        const box = dropzone.getBoundingClientRect()
        const viewport = form.getBoundingClientRect()
        return box.top >= viewport.top && box.bottom <= viewport.bottom
      })
      .toBe(true)
    expect(heading.getBoundingClientRect().top).toBe(headingTop)
    expect(submit.getBoundingClientRect().top).toBe(submitTop)
    await screen.getByRole('radio', { name: 'Start empty' }).click()
  }
})

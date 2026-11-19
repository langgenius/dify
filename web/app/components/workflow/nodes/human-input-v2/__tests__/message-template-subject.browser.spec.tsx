import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createTestQueryClient } from '@/test/query-client'
import MessageTemplateSubject from '../components/message-template-subject'

const insertVariableLabel = 'workflow.nodes.humanInputV2.template.insertVariable'
const searchVariableLabel = 'workflow.common.searchVar'

function MessageTemplateSubjectHarness() {
  const [subject, setSubject] = useState('Before placeholder After')
  const [queryClient] = useState(() => {
    const client = createTestQueryClient()
    seedModelProviderQueries(client)
    return client
  })
  return (
    <QueryClientProvider client={queryClient}>
      <ReactFlowProvider>
        <Dialog defaultOpen>
          <DialogContent className="w-180">
            <DialogHeader>
              <DialogTitle>Message template</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Field name="subject">
                <FieldLabel id="template-subject-label" htmlFor="template-subject">
                  Subject
                </FieldLabel>
                <MessageTemplateSubject
                  id="template-subject"
                  aria-labelledby="template-subject-label"
                  availableNodes={[
                    createNode({
                      id: 'loop',
                      data: { type: BlockEnum.Loop, title: 'Contract loop' },
                    }),
                  ]}
                  value={subject}
                  onValueChange={setSubject}
                  availableVars={[
                    {
                      nodeId: 'loop',
                      title: 'Contract loop',
                      vars: [{ variable: 'round', type: VarType.number }],
                    },
                  ]}
                />
              </Field>
              <output aria-label="Draft subject">{subject}</output>
              <textarea
                aria-label="Clipboard source"
                value={'Pasted {{#loop.round#}}\nNext'}
                readOnly
              />
            </DialogBody>
          </DialogContent>
        </Dialog>
      </ReactFlowProvider>
    </QueryClientProvider>
  )
}

it('replaces a native subject selection through the portalled picker and keeps Escape local to the picker', async () => {
  // Chromium must exercise native selection and focus moving through Dialog and Popover portals.
  // A happy-dom-only selection simulation does not prove typing resumes after the inserted variable.
  await render(<MessageTemplateSubjectHarness />)
  const dialog = page.getByRole('dialog', { name: 'Message template', exact: true })
  const subject = page.getByRole('textbox', { name: 'Subject', exact: true })
  await expect.element(dialog).toBeVisible()
  await subject.click()
  await userEvent.keyboard(detectPlatform() === 'mac' ? '{Meta>}{ArrowLeft}{/Meta}' : '{Home}')
  await userEvent.keyboard('{ArrowRight>7/}{Shift>}{ArrowRight>11/}{/Shift}')
  expect(window.getSelection()?.toString()).toBe('placeholder')

  await page.getByRole('button', { name: insertVariableLabel }).click()
  const search = page.getByRole('searchbox', { name: searchVariableLabel })
  await expect.element(search).toBeVisible()
  await search.fill('round')
  await page.getByText('round', { exact: true }).click()

  await expect.element(subject.getByText('round', { exact: true })).toBeVisible()
  await expect.element(subject).not.toHaveTextContent('{{#loop.round#}}')
  await expect.element(subject).toHaveFocus()
  await userEvent.keyboard('!')
  await expect
    .element(page.getByRole('status', { name: 'Draft subject' }))
    .toHaveTextContent('Before {{#loop.round#}}! After')

  await page.getByRole('button', { name: insertVariableLabel }).click()
  await expect.element(search).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(search).not.toBeInTheDocument()
  await expect.element(dialog).toBeVisible()
  await expect.element(subject.getByText('round', { exact: true })).toBeVisible()

  await subject.click()
  await userEvent.keyboard('{Enter}{Shift>}{Enter}{/Shift}')
  const draft = page.getByRole('status', { name: 'Draft subject' })
  await expect.poll(() => draft.element().textContent).toBe('Before {{#loop.round#}}! After')

  const modifier = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await page.getByRole('textbox', { name: 'Clipboard source' }).click()
  await userEvent.keyboard(`{${modifier}>}a{/${modifier}}`)
  await userEvent.copy()
  await subject.click()
  await userEvent.keyboard(`{${modifier}>}a{/${modifier}}`)
  await userEvent.paste()
  await expect.poll(() => draft.element().textContent).toBe('Pasted {{#loop.round#}} Next')
  await expect.element(subject.getByText('round', { exact: true })).toBeVisible()
})

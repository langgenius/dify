import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtom, useAtomValue } from 'jotai'
import { defaultAgentSoulConfigFormState } from '../form-state'
import { AgentComposerProvider } from '../provider'
import {
  agentComposerDraftAtom,
  agentComposerSavedDraftAtom,
  isAgentComposerDirtyAtom,
} from '../store'

function DraftEditor() {
  const [draft, setDraft] = useAtom(agentComposerDraftAtom)
  const savedDraft = useAtomValue(agentComposerSavedDraftAtom)
  const isDirty = useAtomValue(isAgentComposerDirtyAtom)
  return (
    <>
      <textarea
        aria-label="Prompt"
        value={draft.prompt}
        onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
      />
      <output aria-label="Saved prompt">{savedDraft?.prompt}</output>
      <output aria-label="Unsaved changes">{String(isDirty)}</output>
    </>
  )
}

it('keeps edits and dirty state isolated between composers while preserving each saved baseline', async () => {
  const user = userEvent.setup()
  render(
    <>
      <section aria-label="First agent">
        <AgentComposerProvider
          initialDraft={{ ...defaultAgentSoulConfigFormState, prompt: 'Agent one' }}
        >
          <DraftEditor />
        </AgentComposerProvider>
      </section>
      <section aria-label="Second agent">
        <AgentComposerProvider
          initialDraft={{ ...defaultAgentSoulConfigFormState, prompt: 'Agent two' }}
        >
          <DraftEditor />
        </AgentComposerProvider>
      </section>
    </>,
  )
  const first = within(screen.getByRole('region', { name: 'First agent' }))
  const second = within(screen.getByRole('region', { name: 'Second agent' }))
  expect(first.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Agent one')
  expect(first.getByLabelText('Unsaved changes')).toHaveTextContent('false')
  await user.type(first.getByRole('textbox', { name: 'Prompt' }), ' revised')
  expect(first.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Agent one revised')
  expect(first.getByLabelText('Saved prompt')).toHaveTextContent('Agent one')
  expect(first.getByLabelText('Unsaved changes')).toHaveTextContent('true')
  expect(second.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Agent two')
  expect(second.getByLabelText('Saved prompt')).toHaveTextContent('Agent two')
  expect(second.getByLabelText('Unsaved changes')).toHaveTextContent('false')
})

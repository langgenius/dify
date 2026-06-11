'use client'
import type { WorkflowGeneratorMode } from './types'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  mode: WorkflowGeneratorMode
  onSelect: (prompt: string) => void
}>

/**
 * "Try one of these" chips that sit below the instruction textarea.
 *
 * For brand-new users the blank instruction box is intimidating — they don't
 * know what kinds of prompts the planner handles well. The chips give them
 * a one-click way to populate a real prompt so they can see the modal end-
 * to-end on their first attempt.
 *
 * The four prompts per mode are intentionally chosen to cover a spread of
 * shapes:
 *   - workflow: summarization, translation, RAG, classification.
 *   - advanced-chat: support agent, tutor, triage.
 *
 * The strings live in i18n so they translate alongside the rest of the
 * generator UI.
 */
const ExamplePrompts: React.FC<Props> = ({ mode, onSelect }) => {
  const { t } = useTranslation('workflow')

  const prompts = useMemo(() => {
    if (mode === 'workflow') {
      return [
        t('workflowGenerator.examples.workflow.summarize'),
        t('workflowGenerator.examples.workflow.translate'),
        t('workflowGenerator.examples.workflow.rag'),
        t('workflowGenerator.examples.workflow.classify'),
      ]
    }
    return [
      t('workflowGenerator.examples.chatflow.support'),
      t('workflowGenerator.examples.chatflow.tutor'),
      t('workflowGenerator.examples.chatflow.triage'),
    ]
  }, [mode, t])

  return (
    <div className="mt-3">
      <div className="mb-1.5 system-xs-medium-uppercase text-text-tertiary">
        {t('workflowGenerator.examples.label')}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {prompts.map(prompt => (
          <button
            key={prompt}
            type="button"
            className="cursor-pointer rounded-md border-[0.5px] border-divider-regular bg-components-button-secondary-bg px-2 py-1 system-xs-regular text-text-secondary hover:bg-components-button-secondary-bg-hover"
            onClick={() => onSelect(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )
}

export default memo(ExamplePrompts)

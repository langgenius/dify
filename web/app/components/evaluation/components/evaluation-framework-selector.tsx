'use client'

import type { EvaluationFramework, EvaluationResourceProps } from '../types'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'
import { useEvaluationResource, useEvaluationStore } from '../store'
import DocLearnMoreLink from './doc-learn-more-link'

const FRAMEWORK_OPTIONS: Array<{ value: EvaluationFramework; label: string }> = [
  { value: 'ragas', label: 'Ragas' },
  { value: 'deepeval', label: 'DeepEval' },
]

const EvaluationFrameworkSelector = ({ resourceType, resourceId }: EvaluationResourceProps) => {
  const { t } = useTranslation(['evaluation'])
  const resource = useEvaluationResource(resourceType, resourceId)
  const setEvaluationFramework = useEvaluationStore((state) => state.setEvaluationFramework)

  return (
    <Select<EvaluationFramework>
      value={resource.evaluationFramework}
      onValueChange={(framework) => {
        if (framework) setEvaluationFramework(resourceType, resourceId, framework)
      }}
    >
      {/* Match the judge model header height beside it. */}
      <div className="flex min-h-6 items-center gap-1">
        <SelectLabel className="system-md-semibold text-text-primary">
          {t(($) => $['judgeFramework.title'])}
        </SelectLabel>
        <Infotip>
          <InfotipTrigger aria-label={t(($) => $['judgeFramework.title'])} />
          <InfotipContent aria-label={t(($) => $['judgeFramework.title'])} className="max-w-72">
            {t(($) => $['judgeFramework.description'])}{' '}
            <DocLearnMoreLink path="/use-dify/evaluate/metrics#choose-a-framework" />
          </InfotipContent>
        </Infotip>
      </div>
      <SelectTrigger aria-label={t(($) => $['judgeFramework.title'])} className="mt-1.5 w-full">
        <SelectValue<EvaluationFramework>>
          {(value) => FRAMEWORK_OPTIONS.find((option) => option.value === value)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {FRAMEWORK_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <SelectItemText>{option.label}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default EvaluationFrameworkSelector

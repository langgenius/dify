import { useMemo } from 'react'
import { useGetLanguage } from '@/context/i18n'
import { BlockEnum } from '@/app/components/workflow/types'

export const useNodeHelpLink = (nodeType: BlockEnum) => {
  const language = useGetLanguage()
  const prefixLink = useMemo(() => {
    if (language === 'zh_Hans')
      return 'https://docs.dify.ai/v/zh-hans/guides/workflow/node/'

    return 'https://docs.dify.ai/guides/workflow/node/'
  }, [language])
  const linkMap = useMemo(() => {
    if (language === 'zh_Hans') {
      return {
        [BlockEnum.Start]: 'start',
        [BlockEnum.End]: 'end',
        [BlockEnum.Answer]: 'answer',
        [BlockEnum.LLM]: 'llm',
        [BlockEnum.KnowledgeRetrieval]: 'knowledge-retrieval',
        [BlockEnum.QuestionClassifier]: 'question-classifier',
        [BlockEnum.IfElse]: 'ifelse',
        [BlockEnum.Code]: 'code',
        [BlockEnum.TemplateTransform]: 'template',
        [BlockEnum.VariableAssigner]: 'variable-assigner',
        [BlockEnum.VariableAggregator]: 'variable-assigner',
        [BlockEnum.Assigner]: 'variable-assignment',
        [BlockEnum.Iteration]: 'iteration',
        [BlockEnum.IterationStart]: 'iteration',
        [BlockEnum.ParameterExtractor]: 'parameter-extractor',
        [BlockEnum.HttpRequest]: 'http-request',
        [BlockEnum.Tool]: 'tools',
        [BlockEnum.DocExtractor]: 'doc-extractor',
        [BlockEnum.ListFilter]: 'list-operator',
      }
    }

    return {
      [BlockEnum.Start]: 'start',
      [BlockEnum.End]: 'end',
      [BlockEnum.Answer]: 'answer',
      [BlockEnum.LLM]: 'llm',
      [BlockEnum.KnowledgeRetrieval]: 'knowledge-retrieval',
      [BlockEnum.QuestionClassifier]: 'question-classifier',
      [BlockEnum.IfElse]: 'ifelse',
      [BlockEnum.Code]: 'code',
      [BlockEnum.TemplateTransform]: 'template',
      [BlockEnum.VariableAssigner]: 'variable-assigner',
      [BlockEnum.VariableAggregator]: 'variable-assigner',
      [BlockEnum.Assigner]: 'variable-assignment',
      [BlockEnum.Iteration]: 'iteration',
      [BlockEnum.IterationStart]: 'iteration',
      [BlockEnum.ParameterExtractor]: 'parameter-extractor',
      [BlockEnum.HttpRequest]: 'http-request',
      [BlockEnum.Tool]: 'tools',
      [BlockEnum.DocExtractor]: 'doc-extractor',
      [BlockEnum.ListFilter]: 'list-operator',
    }
  }, [language])

  return `${prefixLink}${linkMap[nodeType]}`
}

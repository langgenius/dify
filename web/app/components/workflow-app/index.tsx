import {
  useMemo,
} from 'react'
import useSWR from 'swr'
import {
  SupportUploadFileTypes,
} from '@/app/components/workflow/types'
import {
  useWorkflowInit,
} from './hooks'
import {
  initialEdges,
  initialNodes,
} from '@/app/components/workflow/utils'
import Loading from '@/app/components/base/loading'
import { FeaturesProvider } from '@/app/components/base/features'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { fetchFileUploadConfig } from '@/service/common'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import {
  WorkflowContextProvider,
} from '@/app/components/workflow/context'
import { createWorkflowSlice } from './store/workflow/workflow-slice'
import WorkflowAppMain from './components/workflow-main'

const WorkflowAppWithAdditionalContext = () => {
  const {
    data,
    isLoading,
  } = useWorkflowInit()
  const { data: fileUploadConfigResponse } = useSWR({ url: '/files/upload' }, fetchFileUploadConfig)

  const nodesData = useMemo(() => {
    if (data)
      return initialNodes(data.graph.nodes, data.graph.edges)

    return []
  }, [data])
  const edgesData = useMemo(() => {
    if (data)
      return initialEdges(data.graph.edges, data.graph.nodes)

    return []
  }, [data])

  if (!data || isLoading) {
    return (
      <div className='relative flex h-full w-full items-center justify-center'>
        <Loading />
      </div>
    )
  }

  const features = data.features || {}
  const initialFeatures: FeaturesData = {
    file: {
      image: {
        enabled: !!features.file_upload?.image?.enabled,
        number_limits: features.file_upload?.image?.number_limits || 3,
        transfer_methods: features.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
      },
      enabled: !!(features.file_upload?.enabled || features.file_upload?.image?.enabled),
      allowed_file_types: features.file_upload?.allowed_file_types || [SupportUploadFileTypes.image],
      allowed_file_extensions: features.file_upload?.allowed_file_extensions || FILE_EXTS[SupportUploadFileTypes.image].map(ext => `.${ext}`),
      allowed_file_upload_methods: features.file_upload?.allowed_file_upload_methods || features.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
      number_limits: features.file_upload?.number_limits || features.file_upload?.image?.number_limits || 3,
      fileUploadConfig: fileUploadConfigResponse,
    },
    opening: {
      enabled: !!features.opening_statement,
      opening_statement: features.opening_statement,
      suggested_questions: features.suggested_questions,
    },
    suggested: features.suggested_questions_after_answer || { enabled: false },
    speech2text: features.speech_to_text || { enabled: false },
    text2speech: features.text_to_speech || { enabled: false },
    citation: features.retriever_resource || { enabled: false },
    moderation: features.sensitive_word_avoidance || { enabled: false },
  }

  return (
    <WorkflowWithDefaultContext
      edges={edgesData}
      nodes={nodesData}
    >
      <FeaturesProvider features={initialFeatures}>
        <WorkflowAppMain
          nodes={nodesData}
          edges={edgesData}
          viewport={data.graph.viewport}
        />
      </FeaturesProvider>
    </WorkflowWithDefaultContext>
  )
}

const WorkflowAppWrapper = () => {
  return (
    <WorkflowContextProvider
      injectWorkflowStoreSliceFn={createWorkflowSlice}
    >
      <WorkflowAppWithAdditionalContext />
    </WorkflowContextProvider>
  )
}

export default WorkflowAppWrapper

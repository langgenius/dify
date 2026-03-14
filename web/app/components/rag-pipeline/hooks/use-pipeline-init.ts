import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import {
  useWorkflowStore,
} from '@/app/components/workflow/store'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import {
  fetchWorkflowDraft,
  syncWorkflowDraft,
} from '@/service/workflow'
import { usePipelineConfig } from './use-pipeline-config'
import {
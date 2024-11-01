import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import { type MediaExtractorNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'
import { IsExtractAudio, IsExtractAudioWordTimestamps, IsExtractVideo, SpliceMode } from '@/types/app'
const i18nPrefix = 'workflow.errorMsg'

const nodeDefault: NodeDefault<MediaExtractorNodeType> = {
  defaultValue: {
    variable_selector: [],
    variable_config: {
      extract_audio: IsExtractAudio.enabled,
      word_timestamps: IsExtractAudioWordTimestamps.disabled,
      extract_video: IsExtractVideo.disabled,
      splice_mode: SpliceMode.horizontal,
      max_collect_frames: 20,
      blur_threshold: 800,
      similarity_threshold: 0.7,
    },
  },
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.End)
    return nodes
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode ? ALL_CHAT_AVAILABLE_BLOCKS : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes
  },
  checkValid(payload: MediaExtractorNodeType, t: any) {
    let errorMessages = ''
    const { variable_selector: variable } = payload

    if (!errorMessages && !variable?.length)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.assigner.assignedVariable') })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault

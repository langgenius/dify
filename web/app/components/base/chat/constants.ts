import type { ChatConfig } from './types'
import { Resolution } from '@/types/app'

export const INITIAL_CONFIG: ChatConfig = {
  opening_statement: '',
  speech_to_text: { enabled: true },
  user_input_form: [],
  suggested_questions_after_answer: { enabled: false },
  file_upload: {
    image: {
      enabled: false,
      number_limits: 0,
      detail: Resolution.high,
      transfer_methods: [],
    },
  },
}

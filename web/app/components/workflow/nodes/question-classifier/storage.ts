import { createLocalStorageState } from 'foxact/create-local-storage-state'

const [
  useInlineLabelHintDismissed,
  _useInlineLabelHintDismissedValue,
  _useSetInlineLabelHintDismissed,
] = createLocalStorageState<boolean>('question-classifier-inline-label-hint-dismissed')

export {
  useInlineLabelHintDismissed,
}

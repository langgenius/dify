import * as React from 'react'
import { useTranslation } from 'react-i18next'
import SkillEditor from './skill-editor'

type MarkdownFileEditorProps = {
  instanceId?: string
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  onAutoFocus?: () => void
  collaborationEnabled?: boolean
  readOnly?: boolean
}

const MarkdownFileEditor = ({
  instanceId,
  value,
  onChange,
  autoFocus = false,
  onAutoFocus,
  collaborationEnabled,
  readOnly,
}: MarkdownFileEditorProps) => {
  const { t } = useTranslation()
  const handleChange = React.useCallback((val: string) => {
    if (val !== value) {
      onChange(val)
    }
  }, [value, onChange])

  return (
    <div className="flex h-full min-h-0 w-full bg-components-panel-bg">
      {/* Lexical editor defaults to `overflow: visible`; provide a bounded scroll container. */}
      <div className="h-full min-h-0 flex-1 overflow-y-auto">
        <SkillEditor
          instanceId={instanceId}
          value={value}
          onChange={handleChange}
          editable={!readOnly}
          autoFocus={!readOnly && autoFocus}
          onAutoFocus={onAutoFocus}
          collaborationEnabled={readOnly ? false : collaborationEnabled}
          showLineNumbers
          className="h-full"
          wrapperClassName="h-full"
          placeholder={readOnly
            ? undefined
            : (
                <span className="flex items-center gap-1 text-components-input-text-placeholder">
                  <span>{t('promptEditor.skillMarkdown.placeholderPrefix', { ns: 'common' })}</span>
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray px-[1px] text-text-placeholder system-kbd">/</span>
                  <span className="text-[13px] leading-4 underline decoration-dotted">
                    {t('promptEditor.skillMarkdown.placeholderReferenceFiles', { ns: 'common' })}
                  </span>
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray px-[1px] text-text-placeholder system-kbd">@</span>
                  <span className="text-[13px] leading-4 underline decoration-dotted">
                    {t('promptEditor.skillMarkdown.placeholderUseTools', { ns: 'common' })}
                  </span>
                </span>
              )}
        />
      </div>
    </div>
  )
}

export default React.memo(MarkdownFileEditor)

import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import SkillEditor from './skill-editor'

type MarkdownFileEditorProps = {
  value: string
  onChange: (value: string) => void
}

const MarkdownFileEditor: FC<MarkdownFileEditorProps> = ({ value, onChange }) => {
  const { t } = useTranslation()

  return (
    <div className="h-full w-full bg-components-panel-bg">
      <SkillEditor
        value={value}
        onChange={onChange}
        showLineNumbers
        className="h-full"
        wrapperClassName="h-full"
        placeholder={(
          <span className="flex items-center gap-1 text-components-input-text-placeholder">
            <span>{t('promptEditor.skillMarkdown.placeholderPrefix', { ns: 'common' })}</span>
            <span className="system-kbd inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray px-[1px] text-text-placeholder">/</span>
            <span className="text-[13px] leading-4 underline decoration-dotted">
              {t('promptEditor.skillMarkdown.placeholderReferenceFiles', { ns: 'common' })}
            </span>
            <span className="system-kbd inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray px-[1px] text-text-placeholder">@</span>
            <span className="text-[13px] leading-4 underline decoration-dotted">
              {t('promptEditor.skillMarkdown.placeholderUseTools', { ns: 'common' })}
            </span>
          </span>
        )}
      />
    </div>
  )
}

export default React.memo(MarkdownFileEditor)

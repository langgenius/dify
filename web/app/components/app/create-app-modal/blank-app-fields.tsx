import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'

type BlankAppFieldsProps = {
  name: string
  onNameChange: (name: string) => void
  description: string
  onDescriptionChange: (description: string) => void
  appIcon: AppIconSelection
  onAppIconChange: (icon: AppIconSelection) => void
}

export function BlankAppFields({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  appIcon,
  onAppIconChange,
}: BlankAppFieldsProps) {
  const { t } = useTranslation()
  const nameInputId = useId()
  const descriptionInputId = useId()
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)

  return (
    <>
      <div className="flex items-center space-x-3">
        <div className="flex-1">
          <div className="mb-1 flex h-6 items-center">
            <label htmlFor={nameInputId} className="system-sm-semibold text-text-secondary">
              {t(($) => $['newApp.captionName'], { ns: 'app' })}
            </label>
          </div>
          <Input
            id={nameInputId}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t(($) => $['newApp.appNamePlaceholder'], { ns: 'app' }) || ''}
          />
        </div>
        <button
          type="button"
          aria-label={t(($) => $['newApp.captionName'], { ns: 'app' })}
          className="shrink-0 cursor-pointer rounded-2xl border-0 bg-transparent p-0 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          onClick={() => setShowAppIconPicker(true)}
        >
          <AppIcon
            iconType={appIcon.type}
            icon={appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId}
            background={appIcon.type === 'emoji' ? appIcon.background : undefined}
            imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
            size="xxl"
            className="rounded-2xl"
            decorative
          />
        </button>
        {showAppIconPicker && (
          <AppIconPicker
            open={showAppIconPicker}
            initialEmoji={
              appIcon.type === 'emoji'
                ? { icon: appIcon.icon, background: appIcon.background }
                : undefined
            }
            onOpenChange={setShowAppIconPicker}
            onSelect={(payload) => {
              onAppIconChange(payload)
            }}
          />
        )}
      </div>
      <div>
        <div className="mb-1 flex h-6 items-center">
          <label htmlFor={descriptionInputId} className="system-sm-semibold text-text-secondary">
            {t(($) => $['newApp.captionDescription'], { ns: 'app' })}
          </label>
          <span className="ml-1 system-xs-regular text-text-tertiary">
            ({t(($) => $['newApp.optional'], { ns: 'app' })})
          </span>
        </div>
        <Textarea
          id={descriptionInputId}
          className="resize-none"
          placeholder={t(($) => $['newApp.appDescriptionPlaceholder'], { ns: 'app' }) || ''}
          value={description}
          onValueChange={onDescriptionChange}
        />
      </div>
    </>
  )
}

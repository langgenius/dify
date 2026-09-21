import type { ReactElement } from 'react'
import type { useImproveBuilderPrompt } from './use-improve-builder-prompt'
import { Button } from '@langgenius/dify-ui/button'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import {
  workspacePermissionKeysAtom,
  workspacePermissionKeysLoadingAtom,
} from '@/context/permission-state'
import { hasPermission } from '@/utils/permission'

type ModelGuideState = Pick<
  ReturnType<typeof useImproveBuilderPrompt>,
  'modelStatus' | 'isCheckingModel' | 'retryModelCheck'
>

function ModelGuideContent({ modelStatus, isCheckingModel, retryModelCheck }: ModelGuideState) {
  const { t } = useTranslation()
  const permissions = useAtomValue(workspacePermissionKeysAtom)
  const isLoadingPermissions = useAtomValue(workspacePermissionKeysLoadingAtom)
  const canConfigure =
    hasPermission(permissions, 'plugin.model_config') ||
    hasPermission(permissions, 'plugin.plugin_preferences')
  const [_settings, setSettings] = useQueryState(settingsQueryParamName, settingsQueryParser)

  return (
    <>
      <PopoverTitle className="sr-only">
        {t(($) => $['newApp.optimizeWithAI'], { ns: 'app' })}
      </PopoverTitle>
      <PopoverDescription role="status" className="system-sm-regular text-text-secondary">
        {modelStatus === 'loading'
          ? t(($) => $['difyBuilder.modelLoading'], { ns: 'workflow' })
          : modelStatus === 'error'
            ? t(($) => $['difyBuilder.modelLoadFailed'], { ns: 'workflow' })
            : t(($) => $['newApp.optimizeModelRequired'], { ns: 'app' })}
        {modelStatus === 'unavailable' && !isLoadingPermissions && !canConfigure && (
          <> {t(($) => $['newApp.optimizeModelContactAdmin'], { ns: 'app' })}</>
        )}
      </PopoverDescription>
      {modelStatus === 'error' && (
        <Button
          size="small"
          className="self-start"
          loading={isCheckingModel}
          onClick={retryModelCheck}
        >
          {t(($) => $['operation.retry'], { ns: 'common' })}
        </Button>
      )}
      {modelStatus === 'unavailable' && canConfigure && (
        <PopoverClose
          render={<Button type="button" size="small" className="self-start" />}
          onClick={() => void setSettings('provider')}
        >
          {t(($) => $['errorMsg.configureModel'], { ns: 'workflow' })}
        </PopoverClose>
      )}
    </>
  )
}

export function BuilderPromptModelGuide({
  children,
  modelStatus,
  ...modelState
}: ModelGuideState & {
  children: ReactElement
}) {
  const [open, setOpen] = useState(false)
  const suppressFocusOpenRef = useRef(false)
  const showGuide = modelStatus !== 'ready'

  return (
    <Popover
      open={showGuide && open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && (details.reason === 'escape-key' || details.reason === 'close-press'))
          suppressFocusOpenRef.current = true
        setOpen(showGuide && nextOpen)
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) setOpen(false)
      }}
    >
      <PopoverTrigger
        render={children}
        openOnHover={showGuide}
        delay={300}
        closeDelay={200}
        onFocus={() => {
          if (showGuide && !suppressFocusOpenRef.current) setOpen(true)
        }}
        onBlur={() => {
          suppressFocusOpenRef.current = false
        }}
        onKeyDownCapture={(event) => {
          // A focusable disabled Button suppresses the trigger's dismissal handler.
          if (event.key === 'Escape' && showGuide && open) {
            event.preventDefault()
            event.stopPropagation()
            suppressFocusOpenRef.current = true
            setOpen(false)
          }
        }}
      />
      <PopoverContent
        placement="bottom-start"
        initialFocus={false}
        className="flex w-80 max-w-(--available-width) flex-col gap-3 p-3"
      >
        <ModelGuideContent modelStatus={modelStatus} {...modelState} />
      </PopoverContent>
    </Popover>
  )
}

import type { PluginPayload } from '../types'
import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import type { CredentialPermission } from '@/models/permission'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { PermissionLevel } from '@/models/permission'
import { ReadmeEntrance } from '../../readme-panel/entrance'
import {
  useAddPluginCredentialHook,
  useGetPluginCredentialSchemaHook,
  useUpdatePluginCredentialHook,
} from '../hooks/use-credential'
import { CredentialTypeEnum } from '../types'
import PermissionSelector from './permission-selector'

export type ApiKeyModalDataSource = {
  schemas: FormSchema[]
  isLoading?: boolean
  defaultName?: string
  save: (values: {
    name: string
    credentialId?: string
    credentials: Record<string, unknown>
    visibility: CredentialPermission
  }) => Promise<unknown>
}

type ApiKeyModalCommonProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: () => void
  editValues?: Record<string, unknown>
  onRemove?: () => void
  disabled?: boolean
  onUpdate?: () => void
  formSchemas?: FormSchema[]
}

export type ApiKeyModalProps = ApiKeyModalCommonProps &
  (
    | { pluginPayload: PluginPayload; dataSource?: undefined }
    | { pluginPayload?: PluginPayload; dataSource: ApiKeyModalDataSource }
  )

const ApiKeyModalContent = ({
  pluginPayload,
  dataSource,
  open = true,
  onOpenChange,
  onClose,
  editValues,
  onRemove,
  disabled,
  onUpdate,
}: ApiKeyModalCommonProps & {
  pluginPayload?: PluginPayload
  dataSource: ApiKeyModalDataSource
}) => {
  const { t } = useTranslation(['common', 'plugin'])
  const [doingAction, setDoingAction] = useState(false)
  const doingActionRef = useRef(doingAction)
  const handleSetDoingAction = useCallback((value: boolean) => {
    doingActionRef.current = value
    setDoingAction(value)
  }, [])
  const { schemas: mergedData, isLoading } = dataSource
  const [permission, setPermission] = useState<CredentialPermission>(
    editValues?.__visibility__ === PermissionLevel.onlyMe
      ? PermissionLevel.onlyMe
      : PermissionLevel.allTeamMembers,
  )
  const formSchemas = useMemo(() => {
    return [
      {
        type: FormTypeEnum.textInput,
        name: '__name__',
        label: t(($) => $['auth.authorizationName'], { ns: 'plugin' }),
        required: false,
        default: dataSource.defaultName,
      },
      ...mergedData,
    ]
  }, [mergedData, dataSource.defaultName, t])
  const defaultValues = formSchemas.reduce(
    (acc, schema) => {
      if (schema.default) acc[schema.name] = schema.default
      return acc
    },
    {} as Record<string, unknown>,
  )
  const formRef = useRef<FormRefObject>(null)
  const handleConfirm = useCallback(async () => {
    if (doingActionRef.current) return
    const { isCheckValidated, values } = formRef.current?.getFormValues({
      needCheckValidatedValues: true,
      needTransformWhenSecretFieldIsPristine: true,
    }) || { isCheckValidated: false, values: {} }
    if (!isCheckValidated) return

    try {
      const {
        __name__,
        __credential_id__,
        __visibility__,
        __partial_member_list__,
        __created_by__,
        ...restValues
      } = values

      handleSetDoingAction(true)
      await dataSource.save({
        credentials: restValues,
        credentialId: __credential_id__,
        name: __name__ || '',
        visibility: permission,
      })

      onOpenChange?.(false)
      onClose?.()
      onUpdate?.()
    } finally {
      handleSetDoingAction(false)
    }
  }, [dataSource, onClose, onOpenChange, onUpdate, handleSetDoingAction, permission])

  const isDisabled = disabled || isLoading || doingAction
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange?.(nextOpen)
      if (!nextOpen) onClose?.()
    },
    [onClose, onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent backdropProps={{ forceRender: true }} className="w-160">
        <DialogHeader>
          <DialogTitle>{t(($) => $['auth.useApiAuth'], { ns: 'plugin' })}</DialogTitle>
          <DialogDescription>
            {t(($) => $['auth.useApiAuthDesc'], { ns: 'plugin' })}
          </DialogDescription>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody>
          {pluginPayload?.detail && (
            <ReadmeEntrance pluginDetail={pluginPayload.detail} presentation="dialog" />
          )}
          {isLoading && (
            <div className="flex h-40 items-center justify-center">
              <LoadingPlaceholder />
            </div>
          )}
          {!isLoading && !!mergedData.length && (
            <AuthForm
              ref={formRef}
              formSchemas={formSchemas}
              defaultValues={editValues || defaultValues}
              disabled={disabled}
            />
          )}
          {!isLoading && !editValues && (
            <div className="mt-4 px-1">
              <div className="mb-1 system-sm-semibold text-text-secondary">
                {t(($) => $['auth.whoCanUse'], { ns: 'plugin' })}
              </div>
              <PermissionSelector
                disabled={disabled}
                permission={permission}
                onChange={setPermission}
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {editValues && (
            <>
              <Button variant="primary" onClick={onRemove} disabled={isDisabled}>
                {t(($) => $['operation.remove'], { ns: 'common' })}
              </Button>
              <div className="mx-1 h-4 w-px bg-divider-regular"></div>
            </>
          )}
          <Button onClick={() => handleOpenChange(false)} disabled={isDisabled}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </Button>
          <Button variant="primary" onClick={handleConfirm} disabled={isDisabled}>
            {t(($) => $['operation.save'], { ns: 'common' })}
          </Button>
        </DialogFooter>
        <EncryptedBottom />
      </DialogContent>
    </Dialog>
  )
}

const WorkspaceApiKeyModal = ({
  pluginPayload,
  ...props
}: ApiKeyModalCommonProps & { pluginPayload: PluginPayload }) => {
  const { data = [], isLoading } = useGetPluginCredentialSchemaHook(
    pluginPayload,
    CredentialTypeEnum.API_KEY,
  )
  const { mutateAsync: addPluginCredential } = useAddPluginCredentialHook(pluginPayload)
  const { mutateAsync: updatePluginCredential } = useUpdatePluginCredentialHook(pluginPayload)

  return (
    <ApiKeyModalContent
      {...props}
      pluginPayload={pluginPayload}
      dataSource={{
        schemas: props.formSchemas?.length ? props.formSchemas : data,
        isLoading,
        save: ({ name, credentialId, credentials, visibility }) => {
          if (props.editValues) {
            const id = credentialId ?? props.editValues.__credential_id__
            if (typeof id !== 'string') return Promise.reject(new Error('Missing credential ID'))
            return updatePluginCredential({ credentials, credential_id: id, name })
          }
          return addPluginCredential({
            credentials,
            type: CredentialTypeEnum.API_KEY,
            name,
            visibility,
          })
        },
      }}
    />
  )
}

const ApiKeyModal = (props: ApiKeyModalProps) => {
  if (props.dataSource) return <ApiKeyModalContent {...props} dataSource={props.dataSource} />
  return <WorkspaceApiKeyModal {...props} pluginPayload={props.pluginPayload} />
}

export default memo(ApiKeyModal)

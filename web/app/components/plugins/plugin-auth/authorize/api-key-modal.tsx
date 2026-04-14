import type { PluginPayload } from '../types'
import type {
  FormRefObject,
  FormSchema,
} from '@/app/components/base/form/types'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import { FormTypeEnum } from '@/app/components/base/form/types'
import Loading from '@/app/components/base/loading'
import Modal from '@/app/components/base/modal/modal'
import { toast } from '@/app/components/base/ui/toast'
import { useMembers } from '@/service/use-common'
import { cn } from '@/utils/classnames'
import { ReadmeEntrance } from '../../readme-panel/entrance'
import { ReadmeShowType } from '../../readme-panel/store'
import {
  useAddPluginCredentialHook,
  useGetPluginCredentialSchemaHook,
  useUpdatePluginCredentialHook,
} from '../hooks/use-credential'
import type { ToolCredentialAccessScope } from '../types'
import { CredentialTypeEnum } from '../types'

export type ApiKeyModalProps = {
  pluginPayload: PluginPayload
  onClose?: () => void
  editValues?: Record<string, any>
  onRemove?: () => void
  disabled?: boolean
  onUpdate?: () => void
  formSchemas?: FormSchema[]
}
const ApiKeyModal = ({
  pluginPayload,
  onClose,
  editValues,
  onRemove,
  disabled,
  onUpdate,
  formSchemas: formSchemasFromProps = [],
}: ApiKeyModalProps) => {
  const { t } = useTranslation()
  const [doingAction, setDoingAction] = useState(false)
  const doingActionRef = useRef(doingAction)
  const handleSetDoingAction = useCallback((value: boolean) => {
    doingActionRef.current = value
    setDoingAction(value)
  }, [])
  const { data = [], isLoading } = useGetPluginCredentialSchemaHook(pluginPayload, CredentialTypeEnum.API_KEY)
  const { data: membersRes } = useMembers()
  const memberAccounts = membersRes?.accounts ?? []

  const [accessScope, setAccessScope] = useState<ToolCredentialAccessScope>('workspace')
  const [allowedAccountIds, setAllowedAccountIds] = useState<string[]>([])

  useEffect(() => {
    if (!editValues)
      return
    const scope = editValues.__access_scope__ as ToolCredentialAccessScope | undefined
    if (scope === 'workspace' || scope === 'private' || scope === 'restricted')
      setAccessScope(scope)
    const allowed = editValues.__allowed_account_ids__
    if (Array.isArray(allowed))
      setAllowedAccountIds(allowed)
  }, [editValues])

  const mergedData = useMemo(() => {
    if (formSchemasFromProps?.length)
      return formSchemasFromProps

    return data
  }, [formSchemasFromProps, data])
  const formSchemas = useMemo(() => {
    return [
      {
        type: FormTypeEnum.textInput,
        name: '__name__',
        label: t('auth.authorizationName', { ns: 'plugin' }),
        required: false,
      },
      ...mergedData,
    ]
  }, [mergedData, t])
  const defaultValues = formSchemas.reduce((acc, schema) => {
    if (schema.default)
      acc[schema.name] = schema.default
    return acc
  }, {} as Record<string, any>)
  const { mutateAsync: addPluginCredential } = useAddPluginCredentialHook(pluginPayload)
  const { mutateAsync: updatePluginCredential } = useUpdatePluginCredentialHook(pluginPayload)
  const formRef = useRef<FormRefObject>(null)
  const handleConfirm = useCallback(async () => {
    if (doingActionRef.current)
      return
    const {
      isCheckValidated,
      values,
    } = formRef.current?.getFormValues({
      needCheckValidatedValues: true,
      needTransformWhenSecretFieldIsPristine: true,
    }) || { isCheckValidated: false, values: {} }
    if (!isCheckValidated)
      return

    try {
      const {
        __name__,
        __credential_id__,
        ...restValues
      } = values

      handleSetDoingAction(true)
      if (editValues) {
        await updatePluginCredential({
          credentials: restValues,
          credential_id: __credential_id__,
          name: __name__ || '',
          access_scope: accessScope,
          allowed_account_ids: accessScope === 'restricted' ? allowedAccountIds : undefined,
        })
      }
      else {
        await addPluginCredential({
          credentials: restValues,
          type: CredentialTypeEnum.API_KEY,
          name: __name__ || '',
          access_scope: accessScope,
          allowed_account_ids: accessScope === 'restricted' ? allowedAccountIds : undefined,
        })
      }
      toast.success(t('api.actionSuccess', { ns: 'common' }))

      onClose?.()
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [
    addPluginCredential,
    onClose,
    onUpdate,
    updatePluginCredential,
    t,
    editValues,
    handleSetDoingAction,
    accessScope,
    allowedAccountIds,
  ])

  const toggleMemberAllowed = useCallback((id: string) => {
    setAllowedAccountIds((prev) => {
      if (prev.includes(id))
        return prev.filter(x => x !== id)
      return [...prev, id]
    })
  }, [])

  return (
    <Modal
      size="md"
      title={t('auth.useApiAuth', { ns: 'plugin' })}
      subTitle={t('auth.useApiAuthDesc', { ns: 'plugin' })}
      onClose={onClose}
      onCancel={onClose}
      footerSlot={
        (<div></div>)
      }
      bottomSlot={<EncryptedBottom />}
      onConfirm={handleConfirm}
      showExtraButton={!!editValues}
      onExtraButtonClick={onRemove}
      disabled={disabled || isLoading || doingAction}
      clickOutsideNotClose={true}
      wrapperClassName="z-1002!"
    >
      {pluginPayload.detail && (
        <ReadmeEntrance pluginDetail={pluginPayload.detail} showType={ReadmeShowType.modal} />
      )}
      {
        isLoading && (
          <div className="flex h-40 items-center justify-center">
            <Loading />
          </div>
        )
      }
      {
        !isLoading && !!mergedData.length && (
          <div className="max-h-[min(520px,70vh)] space-y-4 overflow-y-auto px-4">
            <div>
              <div className="mb-2 system-sm-medium text-text-secondary">
                {t('auth.credentialAccessTitle', { ns: 'plugin' })}
              </div>
              <div className="space-y-2">
                {([
                  ['workspace', t('auth.credentialAccessWorkspace', { ns: 'plugin' })],
                  ['private', t('auth.credentialAccessPrivate', { ns: 'plugin' })],
                  ['restricted', t('auth.credentialAccessRestricted', { ns: 'plugin' })],
                ] as const).map(([value, label]) => (
                  <label
                    key={value}
                    className={cn(
                      'flex cursor-pointer items-start gap-2 rounded-lg border border-transparent p-2 hover:bg-state-base-hover',
                      accessScope === value && 'border-divider-subtle bg-state-base-hover',
                    )}
                  >
                    <input
                      type="radio"
                      name="credential-access-scope"
                      className="mt-1"
                      checked={accessScope === value}
                      disabled={disabled}
                      onChange={() => setAccessScope(value)}
                    />
                    <span className="system-sm-regular text-text-secondary">{label}</span>
                  </label>
                ))}
              </div>
              {accessScope === 'restricted' && (
                <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-divider-subtle p-2">
                  <div className="mb-2 system-xs-medium text-text-tertiary">
                    {t('auth.credentialAccessRestrictedHint', { ns: 'plugin' })}
                  </div>
                  {memberAccounts.map(m => (
                    <label key={m.id} className="flex cursor-pointer items-center gap-2 py-1">
                      <input
                        type="checkbox"
                        checked={allowedAccountIds.includes(m.id)}
                        disabled={disabled}
                        onChange={() => toggleMemberAllowed(m.id)}
                      />
                      <span className="system-sm-regular text-text-secondary">{m.name}</span>
                      <span className="system-xs-regular text-text-tertiary">{m.email}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <AuthForm
              ref={formRef}
              formSchemas={formSchemas}
              defaultValues={editValues || defaultValues}
              disabled={disabled}
            />
          </div>
        )
      }
    </Modal>
  )
}

export default memo(ApiKeyModal)

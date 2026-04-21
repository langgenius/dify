import type { PluginPayload } from '../types'
import type {
  FormRefObject,
  FormSchema,
} from '@/app/components/base/form/types'
import type { Member } from '@/models/common'
import { toast } from '@langgenius/dify-ui/toast'
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import { FormTypeEnum } from '@/app/components/base/form/types'
import Loading from '@/app/components/base/loading'
// eslint-disable-next-line no-restricted-imports -- legacy modal, migration tracked in #32767
import Modal from '@/app/components/base/modal/modal'
import PermissionSelector from '@/app/components/base/permission-selector'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { PermissionLevel } from '@/models/permission'
import { useMembers } from '@/service/use-common'
import { ReadmeEntrance } from '../../readme-panel/entrance'
import { ReadmeShowType } from '../../readme-panel/store'
import {
  useAddPluginCredentialHook,
  useGetPluginCredentialSchemaHook,
  useUpdatePluginCredentialHook,
} from '../hooks/use-credential'
import { CredentialTypeEnum } from '../types'

export type ApiKeyModalProps = {
  pluginPayload: PluginPayload
  onClose?: () => void
  editValues?: Record<string, unknown>
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
  const [permission, setPermission] = useState<PermissionLevel | undefined>(
    (editValues?.__visibility__ as PermissionLevel) ?? PermissionLevel.allTeamMembers,
  )
  const [selectedMemberIDs, setSelectedMemberIDs] = useState<string[]>(
    (editValues?.__partial_member_list__ as string[]) ?? [],
  )
  const { data: membersData } = useMembers()
  const memberList: Member[] = membersData?.accounts ?? []
  const userProfile = useAppContextWithSelector(state => state.userProfile)
  const isCreator = !editValues || !editValues.__created_by__ || editValues.__created_by__ === userProfile.id
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
  }, {} as Record<string, unknown>)
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
        __visibility__,
        __partial_member_list__,
        __created_by__,
        ...restValues
      } = values

      handleSetDoingAction(true)
      const permissionPayload = {
        visibility: permission,
        ...(permission === PermissionLevel.partialMembers
          ? { partial_member_list: selectedMemberIDs.map(id => ({ user_id: id })) }
          : {}),
      }
      if (editValues) {
        await updatePluginCredential({
          credentials: restValues,
          credential_id: __credential_id__,
          name: __name__ || '',
          ...permissionPayload,
        })
      }
      else {
        await addPluginCredential({
          credentials: restValues,
          type: CredentialTypeEnum.API_KEY,
          name: __name__ || '',
          ...permissionPayload,
        })
      }
      toast.success(t('api.actionSuccess', { ns: 'common' }))

      onClose?.()
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [addPluginCredential, onClose, onUpdate, updatePluginCredential, t, editValues, handleSetDoingAction, permission, selectedMemberIDs])

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
          <AuthForm
            ref={formRef}
            formSchemas={formSchemas}
            defaultValues={editValues || defaultValues}
            disabled={disabled}
          />
        )
      }
      {!isLoading && (
        <div className="mt-4 px-1">
          <div className="mb-1 system-sm-semibold text-text-secondary">
            {t('form.permissions', { ns: 'datasetSettings' })}
          </div>
          <PermissionSelector
            disabled={disabled || !isCreator}
            permission={permission}
            value={selectedMemberIDs}
            memberList={memberList}
            onChange={v => setPermission(v)}
            onMemberSelect={setSelectedMemberIDs}
          />
          {!isCreator && (
            <div className="mt-1 system-xs-regular text-text-tertiary">
              Only the credential creator can change permissions.
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

export default memo(ApiKeyModal)

import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

export const NAME_FIELD = {
  type: FormTypeEnum.textInput,
  name: 'name',
  label: {
    en_US: 'Endpoint Name',
    zh_Hans: '端点名称',
    ja_JP: 'エンドポイント名',
    pt_BR: 'Nome do ponto final',
  },
  placeholder: {
    en_US: 'Endpoint Name',
    zh_Hans: '端点名称',
    ja_JP: 'エンドポイント名',
    pt_BR: 'Nome do ponto final',
  },
  required: true,
  default: '',
  help: null,
}

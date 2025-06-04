import { VarType } from '@/app/components/workflow/types'

export const OUTPUT_VARIABLES_MAP = {
  datasource_type: {
    name: 'datasource_type',
    type: VarType.string,
    description: 'local_file, online_document, website_crawl',
  },
  file: {
    name: 'file',
    type: VarType.file,
    description: 'file',
    subItems: [
      {
        name: 'name',
        type: VarType.string,
        description: '',
      },
      {
        name: 'size',
        type: VarType.number,
        description: '',
      },
      {
        name: 'type',
        type: VarType.string,
        description: '',
      },
      {
        name: 'extension',
        type: VarType.string,
        description: '',
      },
      {
        name: 'mime_type',
        type: VarType.string,
        description: '',
      },
      {
        name: 'transfer_method',
        type: VarType.string,
        description: '',
      },
      {
        name: 'url',
        type: VarType.string,
        description: '',
      },
      {
        name: 'related_id',
        type: VarType.string,
        description: '',
      },
    ],
  },
}

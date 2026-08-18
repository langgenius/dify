import type { DatasetListItemResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { DataSet } from '@/models/datasets'

type DatasetCardField =
  | 'app_count'
  | 'description'
  | 'doc_form'
  | 'document_count'
  | 'embedding_available'
  | 'external_knowledge_info'
  | 'icon_info'
  | 'id'
  | 'indexing_technique'
  | 'is_multimodal'
  | 'is_published'
  | 'knowledge_fs_upgrade'
  | 'maintainer'
  | 'name'
  | 'permission_keys'
  | 'pipeline_id'
  | 'provider'
  | 'retrieval_model_dict'
  | 'runtime_mode'
  | 'tags'
  | 'total_available_documents'
  | 'updated_at'

export type DatasetCardItem =
  | Pick<DatasetListItemResponse, DatasetCardField>
  | (Pick<DataSet, Exclude<DatasetCardField, 'knowledge_fs_upgrade'>> & {
      knowledge_fs_upgrade?: DatasetListItemResponse['knowledge_fs_upgrade']
    })

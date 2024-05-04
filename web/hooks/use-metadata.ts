'use client'
import { useTranslation } from 'react-i18next'
import { formatFileSize, formatNumber, formatTime } from '@/utils/format'
import type { DocType } from '@/models/datasets'
import useTimestamp from '@/hooks/use-timestamp'

export type inputType = 'input' | 'select' | 'textarea'
export type metadataType = DocType | 'originInfo' | 'technicalParameters'

type MetadataMap =
    Record<
    metadataType,
    {
      text: string
      allowEdit?: boolean
      icon?: React.ReactNode
      iconName?: string
      subFieldsMap: Record<
      string,
      {
        label: string
        inputType?: inputType
        field?: string
        render?: (value: any, total?: number) => React.ReactNode | string
      }
      >
    }
    >

const fieldPrefix = 'datasetDocuments.metadata.field'

export const useMetadataMap = (): MetadataMap => {
  const { t } = useTranslation()
  const { formatTime: formatTimestamp } = useTimestamp()

  return {
    book: {
      text: t('datasetDocuments.metadata.type.book'),
      iconName: 'bookOpen',
      subFieldsMap: {
        title: { label: t(`${fieldPrefix}.book.title`) },
        language: {
          label: t(`${fieldPrefix}.book.language`),
          inputType: 'select',
        },
        author: { label: t(`${fieldPrefix}.book.author`) },
        publisher: { label: t(`${fieldPrefix}.book.publisher`) },
        publication_date: { label: t(`${fieldPrefix}.book.publicationDate`) },
        isbn: { label: t(`${fieldPrefix}.book.ISBN`) },
        category: {
          label: t(`${fieldPrefix}.book.category`),
          inputType: 'select',
        },
      },
    },
    web_page: {
      text: t('datasetDocuments.metadata.type.webPage'),
      iconName: 'globe',
      subFieldsMap: {
        'title': { label: t(`${fieldPrefix}.webPage.title`) },
        'url': { label: t(`${fieldPrefix}.webPage.url`) },
        'language': {
          label: t(`${fieldPrefix}.webPage.language`),
          inputType: 'select',
        },
        'author/publisher': { label: t(`${fieldPrefix}.webPage.authorPublisher`) },
        'publish_date': { label: t(`${fieldPrefix}.webPage.publishDate`) },
        'topics/keywords': { label: t(`${fieldPrefix}.webPage.topicsKeywords`) },
        'description': { label: t(`${fieldPrefix}.webPage.description`) },
      },
    },
    paper: {
      text: t('datasetDocuments.metadata.type.paper'),
      iconName: 'graduationHat',
      subFieldsMap: {
        'title': { label: t(`${fieldPrefix}.paper.title`) },
        'language': {
          label: t(`${fieldPrefix}.paper.language`),
          inputType: 'select',
        },
        'author': { label: t(`${fieldPrefix}.paper.author`) },
        'publish_date': { label: t(`${fieldPrefix}.paper.publishDate`) },
        'journal/conference_name': {
          label: t(`${fieldPrefix}.paper.journalConferenceName`),
        },
        'volume/issue/page_numbers': { label: t(`${fieldPrefix}.paper.volumeIssuePage`) },
        'doi': { label: t(`${fieldPrefix}.paper.DOI`) },
        'topics/keywords': { label: t(`${fieldPrefix}.paper.topicsKeywords`) },
        'abstract': {
          label: t(`${fieldPrefix}.paper.abstract`),
          inputType: 'textarea',
        },
      },
    },
    social_media_post: {
      text: t('datasetDocuments.metadata.type.socialMediaPost'),
      iconName: 'atSign',
      subFieldsMap: {
        'platform': { label: t(`${fieldPrefix}.socialMediaPost.platform`) },
        'author/username': {
          label: t(`${fieldPrefix}.socialMediaPost.authorUsername`),
        },
        'publish_date': { label: t(`${fieldPrefix}.socialMediaPost.publishDate`) },
        'post_url': { label: t(`${fieldPrefix}.socialMediaPost.postURL`) },
        'topics/tags': { label: t(`${fieldPrefix}.socialMediaPost.topicsTags`) },
      },
    },
    personal_document: {
      text: t('datasetDocuments.metadata.type.personalDocument'),
      iconName: 'file',
      subFieldsMap: {
        'title': { label: t(`${fieldPrefix}.personalDocument.title`) },
        'author': { label: t(`${fieldPrefix}.personalDocument.author`) },
        'creation_date': {
          label: t(`${fieldPrefix}.personalDocument.creationDate`),
        },
        'last_modified_date': {
          label: t(`${fieldPrefix}.personalDocument.lastModifiedDate`),
        },
        'document_type': {
          label: t(`${fieldPrefix}.personalDocument.documentType`),
          inputType: 'select',
        },
        'tags/category': {
          label: t(`${fieldPrefix}.personalDocument.tagsCategory`),
        },
      },
    },
    business_document: {
      text: t('datasetDocuments.metadata.type.businessDocument'),
      iconName: 'briefcase',
      subFieldsMap: {
        'title': { label: t(`${fieldPrefix}.businessDocument.title`) },
        'author': { label: t(`${fieldPrefix}.businessDocument.author`) },
        'creation_date': {
          label: t(`${fieldPrefix}.businessDocument.creationDate`),
        },
        'last_modified_date': {
          label: t(`${fieldPrefix}.businessDocument.lastModifiedDate`),
        },
        'document_type': {
          label: t(`${fieldPrefix}.businessDocument.documentType`),
          inputType: 'select',
        },
        'department/team': {
          label: t(`${fieldPrefix}.businessDocument.departmentTeam`),
        },
      },
    },
    im_chat_log: {
      text: t('datasetDocuments.metadata.type.IMChat'),
      iconName: 'messageTextCircle',
      subFieldsMap: {
        'chat_platform': { label: t(`${fieldPrefix}.IMChat.chatPlatform`) },
        'chat_participants/group_name': {
          label: t(`${fieldPrefix}.IMChat.chatPartiesGroupName`),
        },
        'start_date': { label: t(`${fieldPrefix}.IMChat.startDate`) },
        'end_date': { label: t(`${fieldPrefix}.IMChat.endDate`) },
        'participants': { label: t(`${fieldPrefix}.IMChat.participants`) },
        'topicsKeywords': {
          label: t(`${fieldPrefix}.IMChat.topicsKeywords`),
          inputType: 'textarea',
        },
        'fileType': { label: t(`${fieldPrefix}.IMChat.fileType`) },
      },
    },
    wikipedia_entry: {
      text: t('datasetDocuments.metadata.type.wikipediaEntry'),
      allowEdit: false,
      subFieldsMap: {
        'title': { label: t(`${fieldPrefix}.wikipediaEntry.title`) },
        'language': {
          label: t(`${fieldPrefix}.wikipediaEntry.language`),
          inputType: 'select',
        },
        'web_page_url': { label: t(`${fieldPrefix}.wikipediaEntry.webpageURL`) },
        'editor/contributor': {
          label: t(`${fieldPrefix}.wikipediaEntry.editorContributor`),
        },
        'last_edit_date': {
          label: t(`${fieldPrefix}.wikipediaEntry.lastEditDate`),
        },
        'summary/introduction': {
          label: t(`${fieldPrefix}.wikipediaEntry.summaryIntroduction`),
          inputType: 'textarea',
        },
      },
    },
    synced_from_notion: {
      text: t('datasetDocuments.metadata.type.notion'),
      allowEdit: false,
      subFieldsMap: {
        'title': { label: t(`${fieldPrefix}.notion.title`) },
        'language': { label: t(`${fieldPrefix}.notion.lang`), inputType: 'select' },
        'author/creator': { label: t(`${fieldPrefix}.notion.author`) },
        'creation_date': { label: t(`${fieldPrefix}.notion.createdTime`) },
        'last_modified_date': {
          label: t(`${fieldPrefix}.notion.lastModifiedTime`),
        },
        'notion_page_link': { label: t(`${fieldPrefix}.notion.url`) },
        'category/tags': { label: t(`${fieldPrefix}.notion.tag`) },
        'description': { label: t(`${fieldPrefix}.notion.desc`) },
      },
    },
    synced_from_github: {
      text: t('datasetDocuments.metadata.type.github'),
      allowEdit: false,
      subFieldsMap: {
        'repository_name': { label: t(`${fieldPrefix}.github.repoName`) },
        'repository_description': { label: t(`${fieldPrefix}.github.repoDesc`) },
        'repository_owner/organization': { label: t(`${fieldPrefix}.github.repoOwner`) },
        'code_filename': { label: t(`${fieldPrefix}.github.fileName`) },
        'code_file_path': { label: t(`${fieldPrefix}.github.filePath`) },
        'programming_language': { label: t(`${fieldPrefix}.github.programmingLang`) },
        'github_link': { label: t(`${fieldPrefix}.github.url`) },
        'open_source_license': { label: t(`${fieldPrefix}.github.license`) },
        'commit_date': { label: t(`${fieldPrefix}.github.lastCommitTime`) },
        'commit_author': {
          label: t(`${fieldPrefix}.github.lastCommitAuthor`),
        },
      },
    },
    originInfo: {
      text: '',
      allowEdit: false,
      subFieldsMap: {
        'name': { label: t(`${fieldPrefix}.originInfo.originalFilename`) },
        'data_source_info.upload_file.size': {
          label: t(`${fieldPrefix}.originInfo.originalFileSize`),
          render: value => formatFileSize(value),
        },
        'created_at': {
          label: t(`${fieldPrefix}.originInfo.uploadDate`),
          render: value => formatTimestamp(value, t('datasetDocuments.metadata.dateTimeFormat') as string),
        },
        'completed_at': {
          label: t(`${fieldPrefix}.originInfo.lastUpdateDate`),
          render: value => formatTimestamp(value, t('datasetDocuments.metadata.dateTimeFormat') as string),
        },
        'data_source_type': {
          label: t(`${fieldPrefix}.originInfo.source`),
          render: value => t(`datasetDocuments.metadata.source.${value}`),
        },
      },
    },
    technicalParameters: {
      text: t('datasetDocuments.metadata.type.technicalParameters'),
      allowEdit: false,
      subFieldsMap: {
        'dataset_process_rule.mode': {
          label: t(`${fieldPrefix}.technicalParameters.segmentSpecification`),
          render: value => value === 'automatic' ? (t('datasetDocuments.embedding.automatic') as string) : (t('datasetDocuments.embedding.custom') as string),
        },
        'dataset_process_rule.rules.segmentation.max_tokens': {
          label: t(`${fieldPrefix}.technicalParameters.segmentLength`),
          render: value => formatNumber(value),
        },
        'average_segment_length': {
          label: t(`${fieldPrefix}.technicalParameters.avgParagraphLength`),
          render: value => `${formatNumber(value)} characters`,
        },
        'segment_count': {
          label: t(`${fieldPrefix}.technicalParameters.paragraphs`),
          render: value => `${formatNumber(value)} paragraphs`,
        },
        'hit_count': {
          label: t(`${fieldPrefix}.technicalParameters.hitCount`),
          render: (value, total) => {
            const v = value || 0
            return `${!total ? 0 : ((v / total) * 100).toFixed(2)}% (${v}/${total})`
          },
        },
        'indexing_latency': {
          label: t(`${fieldPrefix}.technicalParameters.embeddingTime`),
          render: value => formatTime(value),
        },
        'tokens': {
          label: t(`${fieldPrefix}.technicalParameters.embeddedSpend`),
          render: value => `${formatNumber(value)} tokens`,
        },
      },
    },
  }
}

const langPrefix = 'datasetDocuments.metadata.languageMap.'

export const useLanguages = () => {
  const { t } = useTranslation()
  return {
    zh: t(`${langPrefix}zh`),
    en: t(`${langPrefix}en`),
    es: t(`${langPrefix}es`),
    fr: t(`${langPrefix}fr`),
    de: t(`${langPrefix}de`),
    ja: t(`${langPrefix}ja`),
    ko: t(`${langPrefix}ko`),
    ru: t(`${langPrefix}ru`),
    ar: t(`${langPrefix}ar`),
    pt: t(`${langPrefix}pt`),
    it: t(`${langPrefix}it`),
    nl: t(`${langPrefix}nl`),
    pl: t(`${langPrefix}pl`),
    sv: t(`${langPrefix}sv`),
    tr: t(`${langPrefix}tr`),
    he: t(`${langPrefix}he`),
    hi: t(`${langPrefix}hi`),
    da: t(`${langPrefix}da`),
    fi: t(`${langPrefix}fi`),
    no: t(`${langPrefix}no`),
    hu: t(`${langPrefix}hu`),
    el: t(`${langPrefix}el`),
    cs: t(`${langPrefix}cs`),
    th: t(`${langPrefix}th`),
    id: t(`${langPrefix}id`),
  }
}

const bookCategoryPrefix = 'datasetDocuments.metadata.categoryMap.book.'

export const useBookCategories = () => {
  const { t } = useTranslation()
  return {
    fiction: t(`${bookCategoryPrefix}fiction`),
    biography: t(`${bookCategoryPrefix}biography`),
    history: t(`${bookCategoryPrefix}history`),
    science: t(`${bookCategoryPrefix}science`),
    technology: t(`${bookCategoryPrefix}technology`),
    education: t(`${bookCategoryPrefix}education`),
    philosophy: t(`${bookCategoryPrefix}philosophy`),
    religion: t(`${bookCategoryPrefix}religion`),
    socialSciences: t(`${bookCategoryPrefix}socialSciences`),
    art: t(`${bookCategoryPrefix}art`),
    travel: t(`${bookCategoryPrefix}travel`),
    health: t(`${bookCategoryPrefix}health`),
    selfHelp: t(`${bookCategoryPrefix}selfHelp`),
    businessEconomics: t(`${bookCategoryPrefix}businessEconomics`),
    cooking: t(`${bookCategoryPrefix}cooking`),
    childrenYoungAdults: t(`${bookCategoryPrefix}childrenYoungAdults`),
    comicsGraphicNovels: t(`${bookCategoryPrefix}comicsGraphicNovels`),
    poetry: t(`${bookCategoryPrefix}poetry`),
    drama: t(`${bookCategoryPrefix}drama`),
    other: t(`${bookCategoryPrefix}other`),
  }
}

const personalDocCategoryPrefix
  = 'datasetDocuments.metadata.categoryMap.personalDoc.'

export const usePersonalDocCategories = () => {
  const { t } = useTranslation()
  return {
    notes: t(`${personalDocCategoryPrefix}notes`),
    blogDraft: t(`${personalDocCategoryPrefix}blogDraft`),
    diary: t(`${personalDocCategoryPrefix}diary`),
    researchReport: t(`${personalDocCategoryPrefix}researchReport`),
    bookExcerpt: t(`${personalDocCategoryPrefix}bookExcerpt`),
    schedule: t(`${personalDocCategoryPrefix}schedule`),
    list: t(`${personalDocCategoryPrefix}list`),
    projectOverview: t(`${personalDocCategoryPrefix}projectOverview`),
    photoCollection: t(`${personalDocCategoryPrefix}photoCollection`),
    creativeWriting: t(`${personalDocCategoryPrefix}creativeWriting`),
    codeSnippet: t(`${personalDocCategoryPrefix}codeSnippet`),
    designDraft: t(`${personalDocCategoryPrefix}designDraft`),
    personalResume: t(`${personalDocCategoryPrefix}personalResume`),
    other: t(`${personalDocCategoryPrefix}other`),
  }
}

const businessDocCategoryPrefix
  = 'datasetDocuments.metadata.categoryMap.businessDoc.'

export const useBusinessDocCategories = () => {
  const { t } = useTranslation()
  return {
    meetingMinutes: t(`${businessDocCategoryPrefix}meetingMinutes`),
    researchReport: t(`${businessDocCategoryPrefix}researchReport`),
    proposal: t(`${businessDocCategoryPrefix}proposal`),
    employeeHandbook: t(`${businessDocCategoryPrefix}employeeHandbook`),
    trainingMaterials: t(`${businessDocCategoryPrefix}trainingMaterials`),
    requirementsDocument: t(`${businessDocCategoryPrefix}requirementsDocument`),
    designDocument: t(`${businessDocCategoryPrefix}designDocument`),
    productSpecification: t(`${businessDocCategoryPrefix}productSpecification`),
    financialReport: t(`${businessDocCategoryPrefix}financialReport`),
    marketAnalysis: t(`${businessDocCategoryPrefix}marketAnalysis`),
    projectPlan: t(`${businessDocCategoryPrefix}projectPlan`),
    teamStructure: t(`${businessDocCategoryPrefix}teamStructure`),
    policiesProcedures: t(`${businessDocCategoryPrefix}policiesProcedures`),
    contractsAgreements: t(`${businessDocCategoryPrefix}contractsAgreements`),
    emailCorrespondence: t(`${businessDocCategoryPrefix}emailCorrespondence`),
    other: t(`${businessDocCategoryPrefix}other`),
  }
}

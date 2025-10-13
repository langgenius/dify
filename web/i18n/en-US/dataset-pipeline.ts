const translation = {
  creation: {
    backToKnowledge: 'Back to Knowledge',
    createFromScratch: {
      title: 'Blank knowledge pipeline',
      description: 'Create a custom pipeline from scratch with full control over data processing and structure.',
    },
    importDSL: 'Import from a DSL file',
    createKnowledge: 'Create Knowledge',
    errorTip: 'Failed to create a Knowledge Base',
    successTip: 'Successfully created a Knowledge Base',
    caution: 'Caution',
  },
  templates: {
    customized: 'Customized',
  },
  operations: {
    choose: 'Choose',
    details: 'Details',
    editInfo: 'Edit info',
    useTemplate: 'Use this Knowledge Pipeline',
    backToDataSource: 'Back to Data Source',
    process: 'Process',
    dataSource: 'Data Source',
    saveAndProcess: 'Save & Process',
    preview: 'Preview',
    exportPipeline: 'Export Pipeline',
    convert: 'Convert',
  },
  knowledgeNameAndIcon: 'Knowledge name & icon',
  knowledgeNameAndIconPlaceholder: 'Please enter the name of the Knowledge Base',
  knowledgeDescription: 'Knowledge description',
  knowledgeDescriptionPlaceholder: 'Describe what is in this Knowledge Base. A detailed description allows AI to access the content of the dataset more accurately. If empty, Dify will use the default hit strategy. (Optional)',
  knowledgePermissions: 'Permissions',
  editPipelineInfo: 'Edit pipeline info',
  pipelineNameAndIcon: 'Pipeline name & icon',
  deletePipeline: {
    title: 'Are you sure to delete this pipeline template?',
    content: 'Deleting the pipeline template is irreversible.',
  },
  publishPipeline: {
    success: {
      message: 'Knowledge Pipeline Published',
      tip: '<CustomLink>Go to Documents</CustomLink> to add or manage documents.',
    },
    error: {
      message: 'Failed to Publish Knowledge Pipeline',
    },
  },
  publishTemplate: {
    success: {
      message: 'Pipeline Template Published',
      tip: 'You can use this template on the creation page.',
      learnMore: 'Learn more',
    },
    error: {
      message: 'Failed to Publish Pipeline Template',
    },
  },
  exportDSL: {
    successTip: 'Export pipeline DSL successfully',
    errorTip: 'Failed to export pipeline DSL',
  },
  details: {
    createdBy: 'By {{author}}',
    structure: 'Structure',
    structureTooltip: 'Chunk Structure determines how documents are split and indexed—offering General, Parent-Child, and Q&A modes—and is unique to each knowledge base.',
  },
  testRun: {
    title: 'Test Run',
    tooltip: 'In test run mode, only one document is allowed to be imported at a time for easier debugging and observation.',
    steps: {
      dataSource: 'Data Source',
      documentProcessing: 'Document Processing',
    },
    dataSource: {
      localFiles: 'Local Files',
    },
    notion: {
      title: 'Choose Notion Pages',
      docTitle: 'Notion docs',
    },
  },
  inputField: 'Input Field',
  inputFieldPanel: {
    title: 'User Input Fields',
    description: 'User input fields are used to define and collect variables required during the pipeline execution process. Users can customize the field type and flexibly configure the input value to meet the needs of different data sources or document processing steps.',
    uniqueInputs: {
      title: 'Unique Inputs for Each Entrance',
      tooltip: 'Unique Inputs are only accessible to the selected data source and its downstream nodes. Users won\'t need to fill it in when choosing other data sources. Only input fields referenced by data source variables will appear in the first step(Data Source). All other fields will be shown in the second step(Process Documents).',
    },
    globalInputs: {
      title: 'Global Inputs for All Entrances',
      tooltip: 'Global Inputs are shared across all nodes. Users will need to fill them in when selecting any data source. For example, fields like delimiter and maximum chunk length can be uniformly applied across multiple data sources. Only input fields referenced by Data Source variables appear in the first step (Data Source). All other fields show up in the second step (Process Documents).',
    },
    addInputField: 'Add Input Field',
    editInputField: 'Edit Input Field',
    preview: {
      stepOneTitle: 'Data Source',
      stepTwoTitle: 'Process Documents',
    },
    error: {
      variableDuplicate: 'Variable name already exists. Please choose a different name.',
    },
  },
  addDocuments: {
    title: 'Add Documents',
    steps: {
      chooseDatasource: 'Choose a Data Source',
      processDocuments: 'Process Documents',
      processingDocuments: 'Processing Documents',
    },
    backToDataSource: 'Data Source',
    stepOne: {
      preview: 'Preview',
    },
    stepTwo: {
      chunkSettings: 'Chunk Settings',
      previewChunks: 'Preview Chunks',
    },
    stepThree: {
      learnMore: 'Learn more',
    },
    characters: 'characters',
    selectOnlineDocumentTip: 'Process up to {{count}} pages',
    selectOnlineDriveTip: 'Process up to {{count}} files, maximum {{fileSize}} MB each',
  },
  documentSettings: {
    title: 'Document Settings',
  },
  onlineDocument: {
    pageSelectorTitle: '{{name}} pages',
  },
  onlineDrive: {
    notConnected: '{{name}} is not connected',
    notConnectedTip: 'To sync with {{name}}, connection to {{name}} must be established first.',
    breadcrumbs: {
      allBuckets: 'All Cloud Storage Buckets',
      allFiles: 'All Files',
      searchResult: 'Find {{searchResultsLength}} items in "{{folderName}}" folder',
      searchPlaceholder: 'Search files...',
    },
    notSupportedFileType: 'This file type is not supported',
    emptyFolder: 'This folder is empty',
    emptySearchResult: 'No items were found',
    resetKeywords: 'Reset keywords',
  },
  credentialSelector: {
    name: '{{credentialName}}\'s {{pluginName}}',
  },
  configurationTip: 'Configure {{pluginName}}',
  conversion: {
    title: 'Convert to Knowledge Pipeline',
    descriptionChunk1: 'You can now convert your existing knowledge base to use the Knowledge Pipeline for document processing',
    descriptionChunk2: ' — a more open and flexible approach with access to plugins from our marketplace. This will apply the new processing method to all future documents.',
    warning: 'This action cannot be undone.',
    confirm: {
      title: 'Confirmation',
      content: 'This action is permanent. You won\'t be able to revert to the previous method.Please confirm to convert.',
    },
    errorMessage: 'Failed to convert the dataset to a pipeline',
    successMessage: 'Successfully converted the dataset to a pipeline',
  },
}

export default translation

const translation = {
  creation: {
    title: 'Create knowledge pipeline',
    createFromScratch: {
      title: 'Create from scratch',
      description: 'Blank knowledge pipeline',
    },
    ImportDSL: {
      title: 'Import',
      description: 'Import from a DSL file',
    },
    createKnowledge: 'Create Knowledge',
  },
  tabs: {
    builtInPipeline: 'Built-in pipeline',
    customized: 'Customized',
  },
  operations: {
    choose: 'Choose',
    details: 'Details',
    editInfo: 'Edit info',
    exportDSL: 'Export DSL',
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
  exportDSL: {
    successTip: 'Export pipeline DSL successfully',
    errorTip: 'Failed to export pipeline DSL',
  },
}

export default translation

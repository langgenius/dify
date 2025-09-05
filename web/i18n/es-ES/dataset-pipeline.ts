const translation = {
  creation: {
    createFromScratch: {
      title: 'Canalización de conocimiento en blanco',
      description: 'Cree una canalización personalizada desde cero con control total sobre el procesamiento y la estructura de datos.',
    },
    caution: 'Cautela',
    backToKnowledge: 'Volver al conocimiento',
    successTip: 'Creó con éxito una base de conocimientos',
    createKnowledge: 'Crear conocimiento',
    errorTip: 'No se pudo crear una base de conocimiento',
    importDSL: 'Importar desde un archivo DSL',
  },
  templates: {
    customized: 'Personalizado',
  },
  operations: {
    preview: 'Vista previa',
    details: 'Detalles',
    dataSource: 'Fuente de datos',
    convert: 'Convertir',
    choose: 'Elegir',
    process: 'Proceso',
    backToDataSource: 'Volver a la fuente de datos',
    editInfo: 'Editar información',
    exportPipeline: 'Canalización de exportación',
    useTemplate: 'Utilice esta canalización de conocimiento',
    saveAndProcess: 'Guardar y procesar',
  },
  deletePipeline: {
    content: 'La eliminación de la plantilla de canalización es irreversible.',
    title: '¿Está seguro de eliminar esta plantilla de canalización?',
  },
  publishPipeline: {
    success: {
      message: 'Publicación de Knowledge Pipeline',
    },
    error: {
      message: 'No se pudo publicar la canalización de conocimiento',
    },
  },
  publishTemplate: {
    success: {
      learnMore: 'Aprende más',
      message: 'Plantilla de canalización publicada',
      tip: 'Puede usar esta plantilla en la página de creación.',
    },
    error: {
      message: 'No se pudo publicar la plantilla de canalización',
    },
  },
  exportDSL: {
    successTip: 'Exportar DSL de canalización correctamente',
    errorTip: 'No se pudo exportar DSL de canalización',
  },
  details: {
    structure: 'Structure',
    structureTooltip: 'La estructura de fragmentos determina cómo se dividen e indexan los documentos, ofreciendo modos General, Principal-Secundario y Preguntas y respuestas, y es única para cada base de conocimiento.',
  },
  testRun: {
    steps: {
      documentProcessing: 'Procesamiento de documentos',
      dataSource: 'Fuente de datos',
    },
    dataSource: {
      localFiles: 'Archivos locales',
    },
    notion: {
      docTitle: 'Documentos de Notion',
      title: 'Elegir páginas de nociones',
    },
    title: 'Ejecución de prueba',
    tooltip: 'En el modo de ejecución de prueba, solo se permite importar un documento a la vez para facilitar la depuración y la observación.',
  },
  inputFieldPanel: {
    uniqueInputs: {
      title: 'Entradas únicas para cada entrada',
      tooltip: 'Las entradas únicas solo son accesibles para la fuente de datos seleccionada y sus nodos posteriores. Los usuarios no tendrán que rellenarlo al elegir otros orígenes de datos. Solo los campos de entrada a los que hacen referencia las variables de origen de datos aparecerán en el primer paso (Origen de datos). Todos los demás campos se mostrarán en el segundo paso (Procesar documentos).',
    },
    globalInputs: {
      title: 'Entradas globales para todas las entradas',
      tooltip: 'Las entradas globales se comparten entre todos los nodos. Los usuarios deberán completarlos al seleccionar cualquier fuente de datos. Por ejemplo, campos como el delimitador y la longitud máxima del fragmento se pueden aplicar de manera uniforme en varias fuentes de datos. Solo los campos de entrada a los que hacen referencia las variables de origen de datos aparecen en el primer paso (origen de datos). Todos los demás campos aparecen en el segundo paso (Procesar documentos).',
    },
    preview: {
      stepTwoTitle: 'Documentos de proceso',
      stepOneTitle: 'Fuente de datos',
    },
    error: {
      variableDuplicate: 'El nombre de la variable ya existe. Por favor, elija un nombre diferente.',
    },
    addInputField: 'Agregar campo de entrada',
    title: 'Campos de entrada de usuario',
    editInputField: 'Editar campo de entrada',
    description: 'Los campos de entrada del usuario se utilizan para definir y recopilar las variables necesarias durante el proceso de ejecución de la canalización. Los usuarios pueden personalizar el tipo de campo y configurar de forma flexible el valor de entrada para satisfacer las necesidades de diferentes fuentes de datos o pasos de procesamiento de documentos.',
  },
  addDocuments: {
    steps: {
      processingDocuments: 'Procesamiento de documentos',
      processDocuments: 'Documentos de proceso',
      chooseDatasource: 'Elegir una fuente de datos',
    },
    stepOne: {
      preview: 'Vista previa',
    },
    stepTwo: {
      chunkSettings: 'Configuración de fragmentos',
      previewChunks: 'Vista previa de fragmentos',
    },
    stepThree: {
      learnMore: 'Aprende más',
    },
    characters: 'Caracteres',
    title: 'Agregar documentos',
    backToDataSource: 'Fuente de datos',
  },
  documentSettings: {
    title: 'Parametrizaciones de documentos',
  },
  onlineDocument: {},
  onlineDrive: {
    breadcrumbs: {
      allBuckets: 'Todos los depósitos de Cloud Storage',
      allFiles: 'Todos los archivos',
      searchPlaceholder: 'Buscar archivos...',
    },
    emptySearchResult: 'No se encontraron artículos',
    resetKeywords: 'Restablecer palabras clave',
    emptyFolder: 'Esta carpeta está vacía',
    notSupportedFileType: 'Este tipo de archivo no es compatible',
  },
  credentialSelector: {},
  conversion: {
    confirm: {
      title: 'Confirmación',
      content: 'Esta acción es permanente. No podrá volver al método anterior. Por favor, confirme para convertir.',
    },
    title: 'Convertir en canalización de conocimiento',
    successMessage: 'Convertir correctamente el conjunto de datos en una canalización',
    warning: 'Esta acción no se puede deshacer.',
    errorMessage: 'No se pudo convertir el conjunto de datos en una canalización',
    descriptionChunk2: '— un enfoque más abierto y flexible con acceso a complementos de nuestro mercado. Esto aplicará el nuevo método de procesamiento a todos los documentos futuros.',
    descriptionChunk1: 'Ahora puede convertir su base de conocimientos existente para usar la canalización de conocimientos para el procesamiento de documentos',
  },
  knowledgeDescription: 'Descripción del conocimiento',
  knowledgeNameAndIcon: 'Nombre e icono de conocimiento',
  inputField: 'Campo de entrada',
  knowledgeNameAndIconPlaceholder: 'Ingrese el nombre de la base de conocimientos',
  knowledgeDescriptionPlaceholder: 'Describa lo que hay en esta base de conocimientos. Una descripción detallada permite a la IA acceder al contenido del conjunto de datos con mayor precisión. Si está vacío, Dify usará la estrategia de golpe predeterminada. (Opcional)',
  pipelineNameAndIcon: 'Nombre e icono de la tubería',
  knowledgePermissions: 'Permisos',
  editPipelineInfo: 'Editar información de canalización',
}

export default translation

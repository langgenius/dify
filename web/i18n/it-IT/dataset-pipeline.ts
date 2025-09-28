const translation = {
  creation: {
    createFromScratch: {
      title: 'Pipeline di conoscenza vuota',
      description: 'Crea una pipeline personalizzata da zero con il pieno controllo sull\'elaborazione e sulla struttura dei dati.',
    },
    successTip: 'Creazione di una Knowledge Base',
    importDSL: 'Importazione da un file DSL',
    errorTip: 'Impossibile creare una Knowledge Base',
    caution: 'Cautela',
    backToKnowledge: 'Torna alla Conoscenza',
    createKnowledge: 'Creare conoscenza',
  },
  templates: {
    customized: 'Personalizzato',
  },
  operations: {
    details: 'Dettagli',
    choose: 'Scegliere',
    convert: 'Convertire',
    editInfo: 'Modifica informazioni',
    dataSource: 'Origine dati',
    backToDataSource: 'Torna all\'origine dati',
    preview: 'Anteprima',
    saveAndProcess: 'Salva ed elabora',
    process: 'Processo',
    useTemplate: 'Usa questa pipeline di conoscenza',
    exportPipeline: 'Pipeline di esportazione',
  },
  deletePipeline: {
    content: 'L\'eliminazione del modello di pipeline è irreversibile.',
    title: 'Sei sicuro di eliminare questo modello di pipeline?',
  },
  publishPipeline: {
    success: {
      message: 'Pipeline di conoscenza pubblicata',
    },
    error: {
      message: 'Impossibile pubblicare la pipeline delle conoscenze',
    },
  },
  publishTemplate: {
    success: {
      learnMore: 'Ulteriori informazioni',
      message: 'Modello di pipeline pubblicato',
      tip: 'Puoi utilizzare questo modello nella pagina di creazione.',
    },
    error: {
      message: 'Impossibile pubblicare il modello di pipeline',
    },
  },
  exportDSL: {
    errorTip: 'Impossibile esportare il DSL della pipeline',
    successTip: 'Esporta DSL pipeline con successo',
  },
  details: {
    structure: 'Struttura',
    structureTooltip: 'La struttura a blocchi determina il modo in cui i documenti vengono suddivisi e indicizzati, offrendo le modalità Generale, Padre-Figlio e Domande e risposte, ed è univoca per ogni knowledge base.',
  },
  testRun: {
    steps: {
      documentProcessing: 'Elaborazione dei documenti',
      dataSource: 'Origine dati',
    },
    dataSource: {
      localFiles: 'File locali',
    },
    notion: {
      docTitle: 'Documenti di Notion',
      title: 'Scegli le pagine Notion',
    },
    title: 'Esecuzione dei test',
    tooltip: 'In modalità di esecuzione dei test, è possibile importare un solo documento alla volta per semplificare il debug e l\'osservazione.',
  },
  inputFieldPanel: {
    uniqueInputs: {
      title: 'Input univoci per ogni ingresso',
      tooltip: 'Gli input univoci sono accessibili solo all\'origine dati selezionata e ai relativi nodi a valle. Gli utenti non dovranno compilarlo quando scelgono altre fonti di dati. Nel primo passaggio (Origine dati) verranno visualizzati solo i campi di input a cui fanno riferimento le variabili dell\'origine dati. Tutti gli altri campi verranno visualizzati nel secondo passaggio (Elabora documenti).',
    },
    globalInputs: {
      title: 'Input globali per tutti gli ingressi',
      tooltip: 'Gli input globali sono condivisi tra tutti i nodi. Gli utenti dovranno compilarli quando selezionano qualsiasi origine dati. Ad esempio, campi come il delimitatore e la lunghezza massima del blocco possono essere applicati in modo uniforme a più origini dati. Nel primo passaggio (Origine dati) vengono visualizzati solo i campi di input a cui fanno riferimento le variabili Origine dati. Tutti gli altri campi vengono visualizzati nel secondo passaggio (Elabora documenti).',
    },
    preview: {
      stepOneTitle: 'Origine dati',
      stepTwoTitle: 'Elabora documenti',
    },
    error: {
      variableDuplicate: 'Il nome della variabile esiste già. Scegli un nome diverso.',
    },
    editInputField: 'Modifica campo di input',
    title: 'Campi di input dell\'utente',
    addInputField: 'Aggiungi campo di input',
    description: 'I campi di input dell\'utente vengono utilizzati per definire e raccogliere le variabili necessarie durante il processo di esecuzione della pipeline. Gli utenti possono personalizzare il tipo di campo e configurare in modo flessibile il valore di input per soddisfare le esigenze di diverse fonti di dati o fasi di elaborazione dei documenti.',
  },
  addDocuments: {
    steps: {
      processDocuments: 'Elabora documenti',
      chooseDatasource: 'Scegliere un\'origine dati',
      processingDocuments: 'Elaborazione dei documenti',
    },
    stepOne: {
      preview: 'Anteprima',
    },
    stepTwo: {
      chunkSettings: 'Impostazioni blocco',
      previewChunks: 'Anteprima dei blocchi',
    },
    stepThree: {
      learnMore: 'Ulteriori informazioni',
    },
    characters: 'personaggi',
    title: 'Aggiungi documenti',
    backToDataSource: 'Origine dati',
  },
  documentSettings: {
    title: 'Impostazioni documento',
  },
  onlineDocument: {},
  onlineDrive: {
    breadcrumbs: {
      allFiles: 'Tutti i file',
      searchPlaceholder: 'Cerca file...',
      allBuckets: 'Tutti i bucket di archiviazione cloud',
    },
    emptyFolder: 'Questa cartella è vuota',
    resetKeywords: 'Reimposta le parole chiave',
    emptySearchResult: 'Nessun oggetto trovato',
    notSupportedFileType: 'Questo tipo di file non è supportato',
  },
  credentialSelector: {},
  conversion: {
    confirm: {
      content: 'Questa azione è permanente. Non sarà possibile ripristinare il metodo precedente. Si prega di confermare per convertire.',
      title: 'Conferma',
    },
    successMessage: 'Conversione del set di dati in pipeline',
    warning: 'Questa azione non può essere annullata.',
    title: 'Conversione in pipeline di conoscenza',
    descriptionChunk1: 'Ora puoi convertire la tua knowledge base esistente per utilizzare la Knowledge Pipeline per l\'elaborazione dei documenti',
    errorMessage: 'Impossibile convertire il set di dati in una pipeline',
    descriptionChunk2: '— un approccio più aperto e flessibile con l\'accesso ai plugin dal nostro marketplace. In questo modo il nuovo metodo di elaborazione verrà applicato a tutti i documenti futuri.',
  },
  knowledgePermissions: 'Autorizzazioni',
  knowledgeDescription: 'Descrizione della conoscenza',
  inputField: 'Campo di input',
  editPipelineInfo: 'Modificare le informazioni sulla pipeline',
  knowledgeNameAndIcon: 'Nome e icona della Knowledge Base',
  pipelineNameAndIcon: 'Nome e icona della pipeline',
  knowledgeNameAndIconPlaceholder: 'Inserisci il nome della Knowledge Base',
  knowledgeDescriptionPlaceholder: 'Descrivi cosa c\'è in questa Knowledge Base. Una descrizione dettagliata consente all\'intelligenza artificiale di accedere al contenuto del set di dati in modo più accurato. Se vuoto, Dify utilizzerà la strategia di hit predefinita. (Facoltativo)',
}

export default translation

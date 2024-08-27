const translation = {
  createApp: 'CREA APP',
  types: {
    all: 'Tutti',
    chatbot: 'Chatbot',
    agent: 'Agente',
    workflow: 'Flusso di lavoro',
    completion: 'Completamento',
  },
  duplicate: 'Duplica',
  duplicateTitle: 'Duplica App',
  export: 'Esporta DSL',
  exportFailed: 'Esportazione DSL fallita.',
  importDSL: 'Importa file DSL',
  createFromConfigFile: 'Crea da file DSL',
  deleteAppConfirmTitle: 'Eliminare questa app?',
  deleteAppConfirmContent:
    'Eliminare l\'app è irreversibile. Gli utenti non potranno più accedere alla tua app e tutte le configurazioni e i log dei prompt verranno eliminati permanentemente.',
  appDeleted: 'App eliminata',
  appDeleteFailed: 'Eliminazione dell\'app fallita',
  join: 'Unisciti alla comunità',
  communityIntro:
    'Discuta con membri del team, collaboratori e sviluppatori su diversi canali.',
  roadmap: 'Vedi la nostra roadmap',
  newApp: {
    startFromBlank: 'Crea da zero',
    startFromTemplate: 'Crea da modello',
    captionAppType: 'Che tipo di app vuoi creare?',
    chatbotDescription:
      'Crea un\'applicazione basata sulla chat. Questa app utilizza un formato domanda-e-risposta, consentendo più round di conversazione continua.',
    completionDescription:
      'Crea un\'applicazione che genera testo di alta qualità basato sui prompt, come articoli, riassunti, traduzioni e altro.',
    completionWarning: 'Questo tipo di app non sarà più supportato.',
    agentDescription:
      'Crea un Agente intelligente che può scegliere autonomamente gli strumenti per completare i compiti',
    workflowDescription:
      'Crea un\'applicazione che genera testo di alta qualità basato su flussi di lavoro orchestrati con un alto grado di personalizzazione. È adatto per utenti esperti.',
    workflowWarning: 'Attualmente in beta',
    chatbotType: 'Metodo di orchestrazione Chatbot',
    basic: 'Base',
    basicTip: 'Per principianti, può passare a Chatflow in seguito',
    basicFor: 'PER PRINCIPIANTI',
    basicDescription:
      'L\'Orchestrazione di base consente l\'orchestrazione di un\'app Chatbot utilizzando impostazioni semplici, senza la possibilità di modificare i prompt integrati. È adatta per principianti.',
    advanced: 'Chatflow',
    advancedFor: 'Per utenti avanzati',
    advancedDescription:
      'L\'Orchestrazione del flusso di lavoro orchestra i Chatbot sotto forma di flussi di lavoro, offrendo un alto grado di personalizzazione, inclusa la possibilità di modificare i prompt integrati. È adatta per utenti esperti.',
    captionName: 'Icona e nome dell\'app',
    appNamePlaceholder: 'Dai un nome alla tua app',
    captionDescription: 'Descrizione',
    appDescriptionPlaceholder: 'Inserisci la descrizione dell\'app',
    useTemplate: 'Usa questo modello',
    previewDemo: 'Anteprima demo',
    chatApp: 'Assistente',
    chatAppIntro:
      'Voglio creare un\'applicazione basata sulla chat. Questa app utilizza un formato domanda-e-risposta, consentendo più round di conversazione continua.',
    agentAssistant: 'Nuovo Agente Assistente',
    completeApp: 'Generatore di Testi',
    completeAppIntro:
      'Voglio creare un\'applicazione che genera testo di alta qualità basato sui prompt, come articoli, riassunti, traduzioni e altro.',
    showTemplates: 'Voglio scegliere da un modello',
    hideTemplates: 'Torna alla selezione della modalità',
    Create: 'Crea',
    Cancel: 'Annulla',
    nameNotEmpty: 'Il nome non può essere vuoto',
    appTemplateNotSelected: 'Seleziona un modello',
    appTypeRequired: 'Seleziona un tipo di app',
    appCreated: 'App creata',
    appCreateFailed: 'Creazione dell\'app fallita',
  },
  editApp: 'Modifica Info',
  editAppTitle: 'Modifica Info App',
  editDone: 'Info app aggiornata',
  editFailed: 'Aggiornamento delle info dell\'app fallito',
  iconPicker: {
    ok: 'OK',
    cancel: 'Annulla',
    emoji: 'Emoji',
    image: 'Immagine',
  },
  switch: 'Passa a Orchestrazione del flusso di lavoro',
  switchTipStart:
    'Verrà creata una nuova copia dell\'app per te, e la nuova copia passerà a Orchestrazione del flusso di lavoro. La nuova copia ',
  switchTip: 'non permetterà',
  switchTipEnd: ' di tornare a Orchestrazione di base.',
  switchLabel: 'La copia dell\'app da creare',
  removeOriginal: 'Elimina l\'app originale',
  switchStart: 'Inizia il passaggio',
  typeSelector: {
    all: 'TUTTI I Tipi',
    chatbot: 'Chatbot',
    agent: 'Agente',
    workflow: 'Flusso di lavoro',
    completion: 'Completamento',
  },
  tracing: {
    title: 'Tracciamento delle prestazioni dell\'app',
    description:
      'Configurazione di un provider LLMOps di terze parti e tracciamento delle prestazioni dell\'app.',
    config: 'Config',
    collapse: 'Comprimi',
    expand: 'Espandi',
    tracing: 'Tracciamento',
    disabled: 'Disabilitato',
    disabledTip: 'Configura prima il provider',
    enabled: 'In servizio',
    tracingDescription:
      'Cattura il contesto completo dell\'esecuzione dell\'app, incluse chiamate LLM, contesto, prompt, richieste HTTP e altro, su una piattaforma di tracciamento di terze parti.',
    configProviderTitle: {
      configured: 'Configurato',
      notConfigured: 'Configura il provider per abilitare il tracciamento',
      moreProvider: 'Altri Provider',
    },
    langsmith: {
      title: 'LangSmith',
      description:
        'Una piattaforma all-in-one per sviluppatori per ogni fase del ciclo di vita delle applicazioni alimentate da LLM.',
    },
    langfuse: {
      title: 'Langfuse',
      description:
        'Tracce, valutazioni, gestione dei prompt e metriche per debug e miglioramento della tua applicazione LLM.',
    },
    inUse: 'In uso',
    configProvider: {
      title: 'Config ',
      placeholder: 'Inserisci il tuo {{key}}',
      project: 'Progetto',
      publicKey: 'Chiave pubblica',
      secretKey: 'Chiave segreta',
      viewDocsLink: 'Visualizza documenti di {{key}}',
      removeConfirmTitle: 'Rimuovere la configurazione di {{key}}?',
      removeConfirmContent:
        'La configurazione attuale è in uso, rimuovendola disattiverà la funzione di Tracciamento.',
    },
  },
}

export default translation

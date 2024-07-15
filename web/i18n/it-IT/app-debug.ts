const translation = {
  pageTitle: {
    line1: 'PROMPT',
    line2: 'Engineering',
  },
  orchestrate: 'Orchestra',
  promptMode: {
    simple: 'Passa alla modalità esperto per modificare tutto il PROMPT',
    advanced: 'Modalità esperto',
    switchBack: 'Torna indietro',
    advancedWarning: {
      title:
        'Sei passato alla modalità esperto e una volta modificato il PROMPT, NON potrai tornare alla modalità base.',
      description: 'In modalità esperto, puoi modificare tutto il PROMPT.',
      learnMore: 'Scopri di più',
      ok: 'OK',
    },
    operation: {
      addMessage: 'Aggiungi messaggio',
    },
    contextMissing:
      'Componente del contesto mancante, l\'efficacia del prompt potrebbe non essere buona.',
  },
  operation: {
    applyConfig: 'Pubblica',
    resetConfig: 'Ripristina',
    debugConfig: 'Debug',
    addFeature: 'Aggiungi funzione',
    automatic: 'Automatico',
    stopResponding: 'Interrompi la risposta',
    agree: 'mi piace',
    disagree: 'non mi piace',
    cancelAgree: 'Annulla mi piace',
    cancelDisagree: 'Annulla non mi piace',
    userAction: 'Azione utente',
  },
  notSetAPIKey: {
    title: 'La chiave del provider LLM non è stata impostata',
    trailFinished: 'Periodo di prova terminato',
    description:
      'La chiave del provider LLM non è stata impostata e deve essere impostata prima del debug.',
    settingBtn: 'Vai alle impostazioni',
  },
  trailUseGPT4Info: {
    title: 'Non supporta gpt-4 adesso',
    description: 'Per utilizzare gpt-4, per favore imposta la chiave API.',
  },
  feature: {
    groupChat: {
      title: 'Migliora chat',
      description:
        'Aggiungere impostazioni pre-conversazione per le app può migliorare l\'esperienza utente.',
    },
    groupExperience: {
      title: 'Migliora esperienza',
    },
    conversationOpener: {
      title: 'Iniziatore di conversazione',
      description:
        'In un\'app di chat, la prima frase che l\'IA pronuncia attivamente all\'utente viene solitamente usata come benvenuto.',
    },
    suggestedQuestionsAfterAnswer: {
      title: 'Follow-up',
      description:
        'Impostare suggerimenti per le prossime domande può offrire agli utenti una chat migliore.',
      resDes: '3 suggerimenti per la prossima domanda dell\'utente.',
      tryToAsk: 'Prova a chiedere',
    },
    moreLikeThis: {
      title: 'Altri simili',
      description:
        'Genera più testi contemporaneamente, poi modifica e continua a generare',
      generateNumTip: 'Numero di ogni generazione',
      tip: 'L\'utilizzo di questa funzione comporterà un costo aggiuntivo di token',
    },
    speechToText: {
      title: 'Da voce a testo',
      description: 'Una volta abilitato, puoi usare l\'input vocale.',
      resDes: 'L\'input vocale è abilitato',
    },
    textToSpeech: {
      title: 'Da testo a voce',
      description:
        'Una volta abilitato, il testo può essere convertito in voce.',
      resDes: 'Il testo in audio è abilitato',
    },
    citation: {
      title: 'Citazioni e attribuzioni',
      description:
        'Una volta abilitato, mostra il documento sorgente e la sezione attribuita del contenuto generato.',
      resDes: 'Citazioni e attribuzioni sono abilitate',
    },
    annotation: {
      title: 'Risposta annotata',
      description:
        'Puoi aggiungere manualmente una risposta di alta qualità alla cache per una corrispondenza prioritaria con domande utente simili.',
      resDes: 'Risposta annotata è abilitata',
      scoreThreshold: {
        title: 'Soglia di punteggio',
        description:
          'Utilizzata per impostare la soglia di somiglianza per la risposta annotata.',
        easyMatch: 'Corrispondenza facile',
        accurateMatch: 'Corrispondenza accurata',
      },
      matchVariable: {
        title: 'Variabile di corrispondenza',
        choosePlaceholder: 'Scegli la variabile di corrispondenza',
      },
      cacheManagement: 'Annotazioni',
      cached: 'Annotato',
      remove: 'Rimuovi',
      removeConfirm: 'Eliminare questa annotazione?',
      add: 'Aggiungi annotazione',
      edit: 'Modifica annotazione',
    },
    dataSet: {
      title: 'Contesto',
      noData: 'Puoi importare Conoscenza come contesto',
      words: 'Parole',
      textBlocks: 'Blocchi di testo',
      selectTitle: 'Seleziona Conoscenza di riferimento',
      selected: 'Conoscenza selezionata',
      noDataSet: 'Nessuna Conoscenza trovata',
      toCreate: 'Vai a creare',
      notSupportSelectMulti: 'Attualmente supporta solo una Conoscenza',
      queryVariable: {
        title: 'Variabile di query',
        tip: 'Questa variabile verrà utilizzata come input di query per il recupero del contesto, ottenendo informazioni contestuali relative all\'input di questa variabile.',
        choosePlaceholder: 'Scegli la variabile di query',
        noVar: 'Nessuna variabile',
        noVarTip: 'per favore crea una variabile nella sezione Variabili',
        unableToQueryDataSet: 'Impossibile interrogare la Conoscenza',
        unableToQueryDataSetTip:
          'Impossibile interrogare la Conoscenza correttamente, per favore scegli una variabile di query nel contesto.',
        ok: 'OK',
        contextVarNotEmpty:
          'La variabile di query del contesto non può essere vuota',
        deleteContextVarTitle: 'Eliminare la variabile “{{varName}}”?',
        deleteContextVarTip:
          'Questa variabile è stata impostata come variabile di query del contesto, rimuoverla influenzerà l\'uso normale della Conoscenza. Se hai ancora bisogno di eliminarla, per favore riselezionala nella sezione del contesto.',
      },
    },
    tools: {
      title: 'Strumenti',
      tips: 'Gli strumenti forniscono un metodo di chiamata API standard, prendendo input dell\'utente o variabili come parametri di richiesta per interrogare dati esterni come contesto.',
      toolsInUse: '{{count}} strumenti in uso',
      modal: {
        title: 'Strumento',
        toolType: {
          title: 'Tipo di strumento',
          placeholder: 'Per favore seleziona il tipo di strumento',
        },
        name: {
          title: 'Nome',
          placeholder: 'Per favore inserisci il nome',
        },
        variableName: {
          title: 'Nome della variabile',
          placeholder: 'Per favore inserisci il nome della variabile',
        },
      },
    },
    conversationHistory: {
      title: 'Cronologia della conversazione',
      description: 'Imposta i nomi di prefisso per i ruoli di conversazione',
      tip: 'La Cronologia della Conversazione non è abilitata, per favore aggiungi <histories> nel prompt sopra.',
      learnMore: 'Scopri di più',
      editModal: {
        title: 'Modifica i nomi dei ruoli della conversazione',
        userPrefix: 'Prefisso utente',
        assistantPrefix: 'Prefisso assistente',
      },
    },
    toolbox: {
      title: 'CASSETTA DEGLI ATTREZZI',
    },
    moderation: {
      title: 'Moderazione del contenuto',
      description:
        'Proteggi l\'output del modello utilizzando l\'API di moderazione o mantenendo un elenco di parole sensibili.',
      allEnabled: 'Contenuto INPUT/OUTPUT abilitato',
      inputEnabled: 'Contenuto INPUT abilitato',
      outputEnabled: 'Contenuto OUTPUT abilitato',
      modal: {
        title: 'Impostazioni di moderazione del contenuto',
        provider: {
          title: 'Provider',
          openai: 'Moderazione OpenAI',
          openaiTip: {
            prefix:
              'La moderazione OpenAI richiede una chiave API OpenAI configurata nel',
            suffix: '.',
          },
          keywords: 'Parole chiave',
        },
        keywords: {
          tip: 'Una per linea, separate da interruzioni di linea. Fino a 100 caratteri per linea.',
          placeholder: 'Una per linea, separate da interruzioni di linea',
          line: 'Linea',
        },
        content: {
          input: 'Modera contenuto INPUT',
          output: 'Modera contenuto OUTPUT',
          preset: 'Risposte preimpostate',
          placeholder: 'Contenuto delle risposte preimpostate qui',
          condition:
            'Moderazione contenuto INPUT e OUTPUT abilitato almeno uno',
          fromApi: 'Le risposte preimpostate sono restituite dall\'API',
          errorMessage: 'Le risposte preimpostate non possono essere vuote',
          supportMarkdown: 'Markdown supportato',
        },
        openaiNotConfig: {
          before:
            'La moderazione OpenAI richiede una chiave API OpenAI configurata nel',
          after: '',
        },
      },
    },
  },
  automatic: {
    title: 'Orchestrazione automatizzata delle applicazioni',
    description:
      'Descrivi il tuo scenario, Dify orchestrerà un\'applicazione per te.',
    intendedAudience: 'Chi è il pubblico di destinazione?',
    intendedAudiencePlaceHolder: 'es. Studente',
    solveProblem: 'Quali problemi sperano che l\'IA possa risolvere per loro?',
    solveProblemPlaceHolder:
      'es. Estrarre approfondimenti e riassumere informazioni da lunghi rapporti e articoli',
    generate: 'Genera',
    audiencesRequired: 'Pubblico richiesto',
    problemRequired: 'Problema richiesto',
    resTitle: 'Abbiamo orchestrato la seguente applicazione per te.',
    apply: 'Applica questa orchestrazione',
    noData:
      'Descrivi il tuo caso d\'uso a sinistra, l\'anteprima dell\'orchestrazione verrà mostrata qui.',
    loading: 'Orchestrazione dell\'applicazione per te...',
    overwriteTitle: 'Sovrascrivere la configurazione esistente?',
    overwriteMessage:
      'Applicando questa orchestrazione sovrascriverai la configurazione esistente.',
  },
  resetConfig: {
    title: 'Confermare il ripristino?',
    message:
      'Il ripristino scarta le modifiche, ripristinando l\'ultima configurazione pubblicata.',
  },
  errorMessage: {
    nameOfKeyRequired: 'nome della chiave: {{key}} richiesto',
    valueOfVarRequired: 'il valore di {{key}} non può essere vuoto',
    queryRequired: 'Il testo della richiesta è richiesto.',
    waitForResponse:
      'Per favore attendi che la risposta al messaggio precedente sia completata.',
    waitForBatchResponse:
      'Per favore attendi che la risposta all\'attività batch sia completata.',
    notSelectModel: 'Per favore scegli un modello',
    waitForImgUpload: 'Per favore attendi il caricamento dell\'immagine',
  },
  chatSubTitle: 'Istruzioni',
  completionSubTitle: 'Prompt di prefisso',
  promptTip:
    'I prompt guidano le risposte dell\'IA con istruzioni e vincoli. Inserisci variabili come {{input}}. Questo prompt non sarà visibile agli utenti.',
  formattingChangedTitle: 'Formato modificato',
  formattingChangedText:
    'Modificare il formato resetterà l\'area di debug, sei sicuro?',
  variableTitle: 'Variabili',
  variableTip:
    'Gli utenti riempiono le variabili in un modulo, sostituendo automaticamente le variabili nel prompt.',
  notSetVar:
    'Le variabili consentono agli utenti di introdurre parole del prompt o osservazioni di apertura quando compilano i moduli. Puoi provare a inserire `{{input}}` nelle parole del prompt.',
  autoAddVar:
    'Le variabili non definite riferite nel pre-prompt, vuoi aggiungerle nel modulo di input dell\'utente?',
  variableTable: {
    key: 'Chiave Variabile',
    name: 'Nome Campo Input Utente',
    optional: 'Opzionale',
    type: 'Tipo di Input',
    action: 'Azioni',
    typeString: 'Stringa',
    typeSelect: 'Seleziona',
  },
  varKeyError: {
    canNoBeEmpty: 'La chiave della variabile non può essere vuota',
    tooLong:
      'La chiave della variabile: {{key}} è troppo lunga. Non può essere più lunga di 30 caratteri',
    notValid:
      'La chiave della variabile: {{key}} non è valida. Può contenere solo lettere, numeri e underscore',
    notStartWithNumber:
      'La chiave della variabile: {{key}} non può iniziare con un numero',
    keyAlreadyExists: 'La chiave della variabile: {{key}} esiste già',
  },
  otherError: {
    promptNoBeEmpty: 'Il prompt non può essere vuoto',
    historyNoBeEmpty:
      'La cronologia delle conversazioni deve essere impostata nel prompt',
    queryNoBeEmpty: 'La query deve essere impostata nel prompt',
  },
  variableConig: {
    'addModalTitle': 'Aggiungi Campo Input',
    'editModalTitle': 'Modifica Campo Input',
    'description': 'Impostazione per la variabile {{varName}}',
    'fieldType': 'Tipo di campo',
    'string': 'Testo breve',
    'text-input': 'Testo breve',
    'paragraph': 'Paragrafo',
    'select': 'Seleziona',
    'number': 'Numero',
    'notSet': 'Non impostato, prova a scrivere {{input}} nel prompt di prefisso',
    'stringTitle': 'Opzioni della casella di testo del modulo',
    'maxLength': 'Lunghezza massima',
    'options': 'Opzioni',
    'addOption': 'Aggiungi opzione',
    'apiBasedVar': 'Variabile basata su API',
    'varName': 'Nome Variabile',
    'labelName': 'Nome Etichetta',
    'inputPlaceholder': 'Per favore inserisci',
    'content': 'Contenuto',
    'required': 'Richiesto',
    'errorMsg': {
      varNameRequired: 'Il nome della variabile è richiesto',
      labelNameRequired: 'Il nome dell\'etichetta è richiesto',
      varNameCanBeRepeat: 'Il nome della variabile non può essere ripetuto',
      atLeastOneOption: 'È richiesta almeno un\'opzione',
      optionRepeat: 'Ci sono opzioni ripetute',
    },
  },
  vision: {
    name: 'Visione',
    description:
      'Abilitare la visione permetterà al modello di prendere immagini e rispondere a domande su di esse.',
    settings: 'Impostazioni',
    visionSettings: {
      title: 'Impostazioni di visione',
      resolution: 'Risoluzione',
      resolutionTooltip: `La bassa risoluzione permetterà al modello di ricevere una versione a bassa risoluzione 512 x 512 dell\\'immagine e di rappresentare l\\'immagine con un budget di 65 token. Questo permette all\\'API di restituire risposte più veloci e di consumare meno token di input per casi d\\'uso che non richiedono alta definizione.
      \n
      L\\'alta risoluzione permetterà al modello di vedere prima l\\'immagine a bassa risoluzione e poi di creare ritagli dettagliati delle immagini di input come quadrati 512px basati sulla dimensione dell\\'immagine di input. Ciascuno dei ritagli dettagliati utilizza il doppio del budget dei token per un totale di 129 token.`,
      high: 'Alta',
      low: 'Bassa',
      uploadMethod: 'Metodo di caricamento',
      both: 'Entrambi',
      localUpload: 'Caricamento locale',
      url: 'URL',
      uploadLimit: 'Limite di caricamento',
    },
  },
  voice: {
    name: 'Voce',
    defaultDisplay: 'Voce predefinita',
    description: 'Impostazioni della voce da testo a voce',
    settings: 'Impostazioni',
    voiceSettings: {
      title: 'Impostazioni della voce',
      language: 'Lingua',
      resolutionTooltip: 'Supporto per la lingua della voce da testo a voce.',
      voice: 'Voce',
      autoPlay: 'Riproduzione automatica',
      autoPlayEnabled: 'Acceso',
      autoPlayDisabled: 'Spento',
    },
  },
  openingStatement: {
    title: 'Iniziatore di conversazione',
    add: 'Aggiungi',
    writeOpener: 'Scrivi introduzione',
    placeholder:
      'Scrivi qui il tuo messaggio introduttivo, puoi usare variabili, prova a scrivere {{variable}}.',
    openingQuestion: 'Domande iniziali',
    noDataPlaceHolder:
      'Iniziare la conversazione con l\'utente può aiutare l\'IA a stabilire un legame più stretto con loro nelle applicazioni conversazionali.',
    varTip: 'Puoi usare variabili, prova a scrivere {{variable}}',
    tooShort:
      'Sono richieste almeno 20 parole di prompt iniziale per generare un\'introduzione alla conversazione.',
    notIncludeKey:
      'Il prompt iniziale non include la variabile: {{key}}. Per favore aggiungila al prompt iniziale.',
  },
  modelConfig: {
    model: 'Modello',
    setTone: 'Imposta tono delle risposte',
    title: 'Modello e Parametri',
    modeType: {
      chat: 'Chat',
      completion: 'Completamento',
    },
  },
  inputs: {
    title: 'Debug e Anteprima',
    noPrompt: 'Prova a scrivere qualche prompt nell\'input pre-prompt',
    userInputField: 'Campo Input Utente',
    noVar:
      'Compila il valore della variabile, che verrà automaticamente sostituito nel prompt ogni volta che inizia una nuova sessione.',
    chatVarTip:
      'Compila il valore della variabile, che verrà automaticamente sostituito nel prompt ogni volta che inizia una nuova sessione',
    completionVarTip:
      'Compila il valore della variabile, che verrà automaticamente sostituito nelle parole del prompt ogni volta che viene inviata una domanda.',
    previewTitle: 'Anteprima prompt',
    queryTitle: 'Contenuto query',
    queryPlaceholder: 'Per favore inserisci il testo della richiesta.',
    run: 'ESEGUI',
  },
  result: 'Testo di output',
  datasetConfig: {
    settingTitle: 'Impostazioni di recupero',
    knowledgeTip: 'Clicca sul pulsante “+” per aggiungere conoscenza',
    retrieveOneWay: {
      title: 'Recupero N-a-1',
      description:
        'Basato sull\'intento dell\'utente e le descrizioni della Conoscenza, l\'Agente seleziona autonomamente la migliore Conoscenza per la query. Ideale per applicazioni con Conoscenze distinte e limitate.',
    },
    retrieveMultiWay: {
      title: 'Recupero multipath',
      description:
        'Basato sull\'intento dell\'utente, esegue query su tutte le Conoscenze, recupera testo rilevante da più fonti e seleziona i migliori risultati corrispondenti alla query dell\'utente dopo il reranking. È richiesta la configurazione dell\'API del modello di reranking.',
    },
    rerankModelRequired: 'Il modello di reranking è richiesto',
    params: 'Parametri',
    top_k: 'Top K',
    top_kTip:
      'Usato per filtrare i chunk più simili alle domande degli utenti. Il sistema regolerà anche dinamicamente il valore di Top K, in base ai max_tokens del modello selezionato.',
    score_threshold: 'Soglia di punteggio',
    score_thresholdTip:
      'Usato per impostare la soglia di somiglianza per il filtraggio dei chunk.',
    retrieveChangeTip:
      'Modificare la modalità di indicizzazione e la modalità di recupero può influenzare le applicazioni associate a questa Conoscenza.',
  },
  debugAsSingleModel: 'Debug come modello singolo',
  debugAsMultipleModel: 'Debug come modelli multipli',
  duplicateModel: 'Duplica',
  publishAs: 'Pubblica come',
  assistantType: {
    name: 'Tipo di assistente',
    chatAssistant: {
      name: 'Assistente base',
      description:
        'Costruisci un assistente basato su chat utilizzando un grande modello linguistico',
    },
    agentAssistant: {
      name: 'Assistente Agente',
      description:
        'Costruisci un Agente intelligente che può scegliere autonomamente strumenti per completare i compiti',
    },
  },
  agent: {
    agentMode: 'Modalità Agente',
    agentModeDes: 'Imposta il tipo di modalità di inferenza per l\'agente',
    agentModeType: {
      ReACT: 'ReAct',
      functionCall: 'Chiamata di Funzione',
    },
    setting: {
      name: 'Impostazioni Agente',
      description:
        'Le impostazioni dell\'Assistente Agente permettono di impostare la modalità agente e funzionalità avanzate come prompt integrati, disponibili solo nel tipo Agente.',
      maximumIterations: {
        name: 'Iterazioni massime',
        description:
          'Limita il numero di iterazioni che un assistente agente può eseguire',
      },
    },
    buildInPrompt: 'Prompt Integrato',
    firstPrompt: 'Primo Prompt',
    nextIteration: 'Prossima Iterazione',
    promptPlaceholder: 'Scrivi qui il tuo prompt',
    tools: {
      name: 'Strumenti',
      description:
        'L\'utilizzo degli strumenti può estendere le capacità del LLM, come cercare su internet o eseguire calcoli scientifici',
      enabled: 'Abilitato',
    },
  },
}

export default translation

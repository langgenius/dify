const translation = {
  currentPlan: 'Piano Attuale',
  upgradeBtn: {
    plain: 'Aggiorna Piano',
    encourage: 'Aggiorna Ora',
    encourageShort: 'Aggiorna',
  },
  viewBilling: 'Gestisci fatturazione e abbonamenti',
  buyPermissionDeniedTip:
    'Contatta l\'amministratore della tua azienda per abbonarti',
  plansCommon: {
    title: 'Scegli un piano adatto a te',
    yearlyTip: 'Ottieni 2 mesi gratis abbonandoti annualmente!',
    mostPopular: 'Più Popolare',
    planRange: {
      monthly: 'Mensile',
      yearly: 'Annuale',
    },
    month: 'mese',
    year: 'anno',
    save: 'Risparmia ',
    free: 'Gratuito',
    currentPlan: 'Piano Attuale',
    contractSales: 'Contatta vendite',
    contractOwner: 'Contatta il responsabile del team',
    startForFree: 'Inizia gratis',
    getStartedWith: 'Inizia con ',
    contactSales: 'Contatta le vendite',
    talkToSales: 'Parla con le vendite',
    modelProviders: 'Fornitori di Modelli',
    teamMembers: 'Membri del Team',
    annotationQuota: 'Quota di Annotazione',
    buildApps: 'Crea App',
    vectorSpace: 'Spazio Vettoriale',
    vectorSpaceBillingTooltip:
      'Ogni 1MB può memorizzare circa 1,2 milioni di caratteri di dati vettoriali (stimato utilizzando OpenAI Embeddings, varia tra i modelli).',
    vectorSpaceTooltip:
      'Lo Spazio Vettoriale è il sistema di memoria a lungo termine necessario per permettere agli LLM di comprendere i tuoi dati.',
    documentsUploadQuota: 'Quota di Caricamento Documenti',
    documentProcessingPriority: 'Priorità di Elaborazione Documenti',
    documentProcessingPriorityTip:
      'Per una maggiore priorità di elaborazione dei documenti, aggiorna il tuo piano.',
    documentProcessingPriorityUpgrade:
      'Elabora più dati con maggiore precisione a velocità più elevate.',
    priority: {
      'standard': 'Standard',
      'priority': 'Priorità',
      'top-priority': 'Massima Priorità',
    },
    logsHistory: 'Storico dei Log',
    customTools: 'Strumenti Personalizzati',
    unavailable: 'Non Disponibile',
    days: 'giorni',
    unlimited: 'Illimitato',
    support: 'Supporto',
    supportItems: {
      communityForums: 'Forum della comunità',
      emailSupport: 'Supporto via email',
      priorityEmail: 'Supporto via email e chat prioritario',
      logoChange: 'Cambia logo',
      SSOAuthentication: 'Autenticazione SSO',
      personalizedSupport: 'Supporto personalizzato',
      dedicatedAPISupport: 'Supporto API dedicato',
      customIntegration: 'Integrazione e supporto personalizzato',
      ragAPIRequest: 'Richieste API RAG',
      bulkUpload: 'Caricamento massivo di documenti',
      agentMode: 'Modalità Agente',
      workflow: 'Flusso di Lavoro',
      llmLoadingBalancing: 'Bilanciamento del Carico LLM',
      llmLoadingBalancingTooltip:
        'Aggiungi più chiavi API ai modelli, bypassando efficacemente i limiti di velocità dell\'API.',
    },
    comingSoon: 'In arrivo',
    member: 'Membro',
    memberAfter: 'Membro',
    messageRequest: {
      title: 'Crediti Messaggi',
      tooltip:
        'Quote di invocazione dei messaggi per vari piani utilizzando i modelli OpenAI (eccetto gpt4). I messaggi oltre il limite utilizzeranno la tua chiave API OpenAI.',
    },
    annotatedResponse: {
      title: 'Limiti di Quota di Annotazione',
      tooltip:
        'La modifica manuale e l\'annotazione delle risposte forniscono capacità di risposta a domande personalizzabili di alta qualità per le app. (Applicabile solo nelle app di chat)',
    },
    ragAPIRequestTooltip:
      'Si riferisce al numero di chiamate API che invocano solo le capacità di elaborazione della base di conoscenza di Dify.',
    receiptInfo:
      'Solo il proprietario del team e l\'amministratore del team possono abbonarsi e visualizzare le informazioni di fatturazione',
  },
  plans: {
    sandbox: {
      name: 'Sandbox',
      description: '200 prove gratuite di GPT',
      includesTitle: 'Include:',
    },
    professional: {
      name: 'Professional',
      description:
        'Per individui e piccoli team per sbloccare più potenza a prezzi accessibili.',
      includesTitle: 'Tutto nel piano gratuito, più:',
    },
    team: {
      name: 'Team',
      description:
        'Collabora senza limiti e goditi prestazioni di alto livello.',
      includesTitle: 'Tutto nel piano Professional, più:',
    },
    enterprise: {
      name: 'Enterprise',
      description:
        'Ottieni tutte le capacità e il supporto per sistemi mission-critical su larga scala.',
      includesTitle: 'Tutto nel piano Team, più:',
    },
  },
  vectorSpace: {
    fullTip: 'Lo Spazio Vettoriale è pieno.',
    fullSolution: 'Aggiorna il tuo piano per ottenere più spazio.',
  },
  apps: {
    fullTipLine1: 'Aggiorna il tuo piano per',
    fullTipLine2: 'creare più app.',
  },
  annotatedResponse: {
    fullTipLine1: 'Aggiorna il tuo piano per',
    fullTipLine2: 'annotare più conversazioni.',
    quotaTitle: 'Quota di Risposta Annotata',
  },
}

export default translation

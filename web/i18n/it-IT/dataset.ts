const translation = {
  knowledge: 'Conoscenza',
  documentCount: ' documenti',
  wordCount: ' k parole',
  appCount: ' app collegate',
  createDataset: 'Crea Conoscenza',
  createDatasetIntro:
    'Importa i tuoi dati testuali o scrivi dati in tempo reale tramite Webhook per migliorare il contesto LLM.',
  deleteDatasetConfirmTitle: 'Eliminare questa Conoscenza?',
  deleteDatasetConfirmContent:
    'L\'eliminazione della Conoscenza è irreversibile. Gli utenti non potranno più accedere alla tua Conoscenza e tutte le configurazioni dei prompt e i log verranno eliminati permanentemente.',
  datasetUsedByApp:
    'La Conoscenza è utilizzata da alcune app. Le app non potranno più utilizzare questa Conoscenza e tutte le configurazioni dei prompt e i log verranno eliminati permanentemente.',
  datasetDeleted: 'Conoscenza eliminata',
  datasetDeleteFailed: 'Eliminazione della Conoscenza fallita',
  didYouKnow: 'Lo sapevi?',
  intro1: 'La Conoscenza può essere integrata nell\'applicazione Dify ',
  intro2: 'come un contesto',
  intro3: ',',
  intro4: 'oppure ',
  intro5: 'può essere creata',
  intro6: ' come un plug-in di indicizzazione ChatGPT autonomo da pubblicare',
  unavailable: 'Non disponibile',
  unavailableTip:
    'Il modello di embedding non è disponibile, è necessario configurare il modello di embedding predefinito',
  datasets: 'CONOSCENZA',
  datasetsApi: 'ACCESSO API',
  retrieval: {
    semantic_search: {
      title: 'Ricerca Vettoriale',
      description:
        'Genera embedding delle query e cerca il blocco di testo più simile alla sua rappresentazione vettoriale.',
    },
    full_text_search: {
      title: 'Ricerca Full-Text',
      description:
        'Indicizza tutti i termini nel documento, consentendo agli utenti di cercare qualsiasi termine e recuperare il blocco di testo rilevante contenente quei termini.',
    },
    hybrid_search: {
      title: 'Ricerca Ibrida',
      description:
        'Esegui contemporaneamente la ricerca full-text e la ricerca vettoriale, riordina per selezionare la migliore corrispondenza per la query dell\'utente. È necessaria la configurazione delle API del modello Rerank.',
      recommend: 'Consigliato',
    },
    invertedIndex: {
      title: 'Indice Invertito',
      description:
        'L\'Indice Invertito è una struttura utilizzata per il recupero efficiente. Organizzato per termini, ogni termine punta ai documenti o alle pagine web che lo contengono.',
    },
    change: 'Cambia',
    changeRetrievalMethod: 'Cambia metodo di recupero',
  },
  docsFailedNotice: 'documenti non riusciti a essere indicizzati',
  retry: 'Riprova',
  indexingTechnique: {
    high_quality: 'AQ',
    economy: 'ECO',
  },
  indexingMethod: {
    semantic_search: 'VETTORE',
    full_text_search: 'TESTO COMPLETO',
    hybrid_search: 'IBRIDO',
    invertedIndex: 'INVERTITO',
  },
  mixtureHighQualityAndEconomicTip: 'Il modello di riclassificazione è necessario per la miscela di basi di conoscenza di alta qualità ed economiche.',
  inconsistentEmbeddingModelTip: 'Il modello di riclassificazione è necessario se i modelli di embedding delle basi di conoscenza selezionate sono incoerenti.',
  retrievalSettings: 'Impostazioni di recupero',
  rerankSettings: 'Impostazioni di riclassificazione',
  weightedScore: {
    title: 'Punteggio ponderato',
    description: 'Regolando i pesi assegnati, questa strategia di riclassificazione determina se dare priorità alla corrispondenza semantica o per parole chiave.',
    semanticFirst: 'Semantica prima',
    keywordFirst: 'Parola chiave prima',
    customized: 'Personalizzato',
    semantic: 'Semantico',
    keyword: 'Parola chiave',
  },
  nTo1RetrievalLegacy: 'Il recupero N-a-1 sarà ufficialmente deprecato da settembre. Si consiglia di utilizzare il più recente recupero multi-percorso per ottenere risultati migliori.',
  nTo1RetrievalLegacyLink: 'Scopri di più',
  nTo1RetrievalLegacyLinkText: 'Il recupero N-a-1 sarà ufficialmente deprecato a settembre.',
  defaultRetrievalTip: 'Per impostazione predefinita, il recupero a percorsi multipli viene utilizzato. Le informazioni vengono recuperate da più knowledge base e quindi riclassificate.',
}

export default translation

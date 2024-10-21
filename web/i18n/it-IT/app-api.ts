const translation = {
  apiServer: 'Server API',
  apiKey: 'Chiave API',
  status: 'Stato',
  disabled: 'Disabilitato',
  ok: 'In Servizio',
  copy: 'Copia',
  copied: 'Copiato',
  play: 'Riproduci',
  pause: 'Pausa',
  playing: 'In Riproduzione',
  loading: 'Caricamento',
  merMaid: {
    rerender: 'Rifare il rendering',
  },
  never: 'Mai',
  apiKeyModal: {
    apiSecretKey: 'Chiave segreta API',
    apiSecretKeyTips:
      'Per prevenire l\'abuso dell\'API, proteggi la tua chiave API. Evita di usarla come testo semplice nel codice front-end. :)',
    createNewSecretKey: 'Crea nuova chiave segreta',
    secretKey: 'Chiave Segreta',
    created: 'CREATA',
    lastUsed: 'ULTIMO UTILIZZO',
    generateTips: 'Conserva questa chiave in un luogo sicuro e accessibile.',
  },
  actionMsg: {
    deleteConfirmTitle: 'Eliminare questa chiave segreta?',
    deleteConfirmTips: 'Questa azione non può essere annullata.',
    ok: 'OK',
  },
  completionMode: {
    title: 'API dell\'App di Completamento',
    info: 'Per una generazione di testo di alta qualità, come articoli, riassunti e traduzioni, utilizza l\'API completion-messages con l\'input dell\'utente. La generazione del testo si basa sui parametri del modello e sui modelli di prompt impostati in Dify Prompt Engineering.',
    createCompletionApi: 'Crea Messaggio di Completamento',
    createCompletionApiTip:
      'Crea un Messaggio di Completamento per supportare la modalità domanda e risposta.',
    inputsTips:
      '(Opzionale) Fornisci campi di input utente come coppie chiave-valore, corrispondenti alle variabili in Prompt Eng. La chiave è il nome della variabile, il Valore è il valore del parametro. Se il tipo di campo è Select, il Valore inviato deve essere una delle scelte preimpostate.',
    queryTips: 'Contenuto del testo di input dell\'utente.',
    blocking:
      'Tipo bloccante, in attesa che l\'esecuzione sia completata e restituisca i risultati. (Le richieste possono essere interrotte se il processo è lungo)',
    streaming:
      'restituzioni in streaming. Implementazione della restituzione in streaming basata su SSE (Server-Sent Events).',
    messageFeedbackApi: 'Feedback sul messaggio (mi piace)',
    messageFeedbackApiTip:
      'Valuta i messaggi ricevuti per conto degli utenti finali con mi piace o non mi piace. Questi dati sono visibili nella pagina Log & Annotazioni e utilizzati per futuri affinamenti del modello.',
    messageIDTip: 'ID del Messaggio',
    ratingTip: 'mi piace o non mi piace, null è annulla',
    parametersApi: 'Ottenere informazioni sui parametri dell\'applicazione',
    parametersApiTip:
      'Recupera i parametri di input configurati, inclusi nomi delle variabili, nomi dei campi, tipi e valori predefiniti. Tipicamente utilizzato per visualizzare questi campi in un modulo o per riempire i valori predefiniti dopo il caricamento del client.',
  },
  chatMode: {
    title: 'API dell\'App di Chat',
    info: 'Per app conversazionali versatili utilizzando un formato Q&A, chiama l\'API chat-messages per avviare il dialogo. Mantieni conversazioni in corso passando l\'conversation_id restituito. I parametri di risposta e i modelli dipendono dalle impostazioni di Dify Prompt Eng.',
    createChatApi: 'Crea messaggio di chat',
    createChatApiTip:
      'Crea un nuovo messaggio di conversazione o continua un dialogo esistente.',
    inputsTips:
      '(Opzionale) Fornisci campi di input utente come coppie chiave-valore, corrispondenti alle variabili in Prompt Eng. La chiave è il nome della variabile, il Valore è il valore del parametro. Se il tipo di campo è Select, il Valore inviato deve essere una delle scelte preimpostate.',
    queryTips: 'Contenuto della domanda di input dell\'utente',
    blocking:
      'Tipo bloccante, in attesa che l\'esecuzione sia completata e restituisca i risultati. (Le richieste possono essere interrotte se il processo è lungo)',
    streaming:
      'restituzioni in streaming. Implementazione della restituzione in streaming basata su SSE (Server-Sent Events).',
    conversationIdTip:
      '(Opzionale) ID della Conversazione: lasciare vuoto per la prima conversazione; passare l\'conversation_id dal contesto per continuare il dialogo.',
    messageFeedbackApi:
      'Feedback terminale del messaggio dell\'utente, mi piace',
    messageFeedbackApiTip:
      'Valuta i messaggi ricevuti per conto degli utenti finali con mi piace o non mi piace. Questi dati sono visibili nella pagina Log & Annotazioni e utilizzati per futuri affinamenti del modello.',
    messageIDTip: 'ID del Messaggio',
    ratingTip: 'mi piace o non mi piace, null è annulla',
    chatMsgHistoryApi: 'Ottieni la cronologia dei messaggi della chat',
    chatMsgHistoryApiTip:
      'La prima pagina restituisce l\'ultimo `limite` barra, che è in ordine inverso.',
    chatMsgHistoryConversationIdTip: 'ID della Conversazione',
    chatMsgHistoryFirstId:
      'ID del primo record di chat nella pagina corrente. L\'impostazione predefinita è nessuna.',
    chatMsgHistoryLimit: 'Quante chat vengono restituite in una richiesta',
    conversationsListApi: 'Ottieni l\'elenco delle conversazioni',
    conversationsListApiTip:
      'Ottiene l\'elenco delle sessioni dell\'utente corrente. Per impostazione predefinita, vengono restituite le ultime 20 sessioni.',
    conversationsListFirstIdTip:
      'ID dell\'ultimo record nella pagina corrente, predefinito nessuno.',
    conversationsListLimitTip:
      'Quante chat vengono restituite in una richiesta',
    conversationRenamingApi: 'Rinomina conversazione',
    conversationRenamingApiTip:
      'Rinomina conversazioni; il nome viene visualizzato nelle interfacce client multi-sessione.',
    conversationRenamingNameTip: 'Nuovo nome',
    parametersApi: 'Ottenere informazioni sui parametri dell\'applicazione',
    parametersApiTip:
      'Recupera i parametri di input configurati, inclusi nomi delle variabili, nomi dei campi, tipi e valori predefiniti. Tipicamente utilizzato per visualizzare questi campi in un modulo o per riempire i valori predefiniti dopo il caricamento del client.',
  },
  develop: {
    requestBody: 'Corpo della Richiesta',
    pathParams: 'Parametri del Percorso',
    query: 'Query',
  },
  regenerate: 'Rigenerare',
}

export default translation

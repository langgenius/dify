const translation = {
  common: {
    welcome: '',
    appUnavailable: 'L\'app non è disponibile',
    appUnknownError: 'L\'app non è disponibile',
  },
  chat: {
    newChat: 'Nuova chat',
    pinnedTitle: 'Fissati',
    unpinnedTitle: 'Chat',
    newChatDefaultName: 'Nuova conversazione',
    resetChat: 'Reimposta conversazione',
    poweredBy: 'Powered by',
    prompt: 'Prompt',
    privatePromptConfigTitle: 'Impostazioni conversazione',
    publicPromptConfigTitle: 'Prompt iniziale',
    configStatusDes:
      'Prima di iniziare, puoi modificare le impostazioni della conversazione',
    configDisabled:
      'Le impostazioni della sessione precedente sono state utilizzate per questa sessione.',
    startChat: 'Inizia Chat',
    privacyPolicyLeft: 'Per favore leggi la ',
    privacyPolicyMiddle: 'politica sulla privacy',
    privacyPolicyRight: ' fornita dallo sviluppatore dell\'app.',
    deleteConversation: {
      title: 'Elimina conversazione',
      content: 'Sei sicuro di voler eliminare questa conversazione?',
    },
    tryToSolve: 'Prova a risolvere',
    temporarySystemIssue: 'Spiacente, problema temporaneo del sistema.',
  },
  generation: {
    tabs: {
      create: 'Esegui una volta',
      batch: 'Esegui batch',
      saved: 'Salvato',
    },
    savedNoData: {
      title: 'Non hai ancora salvato un risultato!',
      description:
        'Inizia a generare contenuti e trova i tuoi risultati salvati qui.',
      startCreateContent: 'Inizia a creare contenuti',
    },
    title: 'Completamento AI',
    queryTitle: 'Contenuto della query',
    completionResult: 'Risultato del completamento',
    queryPlaceholder: 'Scrivi il contenuto della tua query...',
    run: 'Esegui',
    copy: 'Copia',
    resultTitle: 'Completamento AI',
    noData: 'L\'AI ti darà ciò che desideri qui.',
    csvUploadTitle: 'Trascina e rilascia il tuo file CSV qui, oppure ',
    browse: 'sfoglia',
    csvStructureTitle: 'Il file CSV deve rispettare la seguente struttura:',
    downloadTemplate: 'Scarica qui il modello',
    field: 'Campo',
    batchFailed: {
      info: '{{num}} esecuzioni fallite',
      retry: 'Riprova',
      outputPlaceholder: 'Nessun contenuto di output',
    },
    errorMsg: {
      empty: 'Per favore inserisci contenuto nel file caricato.',
      fileStructNotMatch:
        'Il file CSV caricato non corrisponde alla struttura.',
      emptyLine: 'Riga {{rowIndex}} è vuota',
      invalidLine:
        'Riga {{rowIndex}}: il valore di {{varName}} non può essere vuoto',
      moreThanMaxLengthLine:
        'Riga {{rowIndex}}: il valore di {{varName}} non può essere superiore a {{maxLength}} caratteri',
      atLeastOne: 'Per favore inserisci almeno una riga nel file caricato.',
    },
  },
}

export default translation

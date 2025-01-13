const translation = {
  title: 'Impostazioni della Conoscenza',
  desc: 'Qui puoi modificare le proprietà e i metodi di funzionamento della Conoscenza.',
  form: {
    name: 'Nome della Conoscenza',
    namePlaceholder: 'Per favore inserisci il nome della Conoscenza',
    nameError: 'Il nome non può essere vuoto',
    desc: 'Descrizione della Conoscenza',
    descInfo:
      'Per favore scrivi una descrizione chiara per delineare il contenuto della Conoscenza. Questa descrizione sarà utilizzata come base per la corrispondenza quando si seleziona tra più Conoscenze per l\'inferenza.',
    descPlaceholder:
      'Descrivi cosa c\'è in questa Conoscenza. Una descrizione dettagliata permette all\'IA di accedere al contenuto della Conoscenza in modo tempestivo. Se vuota, Dify utilizzerà la strategia di recupero predefinita.',
    descWrite: 'Scopri come scrivere una buona descrizione della Conoscenza.',
    permissions: 'Permessi',
    permissionsOnlyMe: 'Solo io',
    permissionsAllMember: 'Tutti i membri del team',
    permissionsInvitedMembers: 'Membri del team parziali',
    me: '(Tu)',
    indexMethod: 'Metodo di Indicizzazione',
    indexMethodHighQuality: 'Alta Qualità',
    indexMethodHighQualityTip:
      'Chiama il modello di Embedding per l\'elaborazione per fornire maggiore accuratezza quando gli utenti fanno query.',
    indexMethodEconomy: 'Economico',
    indexMethodEconomyTip:
      'Usa motori vettoriali offline, indici di parole chiave, ecc. per ridurre l\'accuratezza senza spendere token',
    embeddingModel: 'Modello di Embedding',
    embeddingModelTip: 'Per cambiare il modello di embedding, vai alle ',
    embeddingModelTipLink: 'Impostazioni',
    retrievalSetting: {
      title: 'Impostazione di Recupero',
      learnMore: 'Scopri di più',
      description: ' sul metodo di recupero.',
      longDescription:
        ' sul metodo di recupero, puoi cambiare questo in qualsiasi momento nelle impostazioni della Conoscenza.',
    },
    save: 'Salva',
    retrievalSettings: 'Impostazioni di recupero',
    externalKnowledgeID: 'ID conoscenza esterna',
    externalKnowledgeAPI: 'API di conoscenza esterna',
    helpText: 'Scopri come scrivere una buona descrizione del set di dati.',
    upgradeHighQualityTip: 'Una volta effettuato l\'aggiornamento alla modalità Alta qualità, il ripristino della modalità Risparmio non è disponibile',
    indexMethodChangeToEconomyDisabledTip: 'Non disponibile per il downgrade da HQ a ECO',
  },
}

export default translation

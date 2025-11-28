const translation = {
  subscription: {
    title: 'Abbonamenti',
    listNum: 'abbonamenti {{num}}',
    empty: {
      title: 'Nessun abbonamento',
      button: 'Nuovo abbonamento',
    },
    createButton: {
      oauth: 'Nuovo abbonamento con OAuth',
      apiKey: 'Nuovo abbonamento con chiave API',
      manual: 'Incolla l\'URL per creare un nuovo abbonamento',
    },
    createSuccess: 'Abbonamento creato con successo',
    createFailed: 'Impossibile creare l\'abbonamento',
    maxCount: 'Max {{num}} abbonamenti',
    selectPlaceholder: 'Seleziona abbonamento',
    noSubscriptionSelected: 'Nessun abbonamento selezionato',
    subscriptionRemoved: 'Abbonamento rimosso',
    list: {
      title: 'Abbonamenti',
      addButton: 'Aggiungi',
      tip: 'Ricevi eventi tramite Sottoscrizione',
      item: {
        enabled: 'Abilitato',
        disabled: 'Disabilitato',
        credentialType: {
          api_key: 'Chiave API',
          oauth2: 'OAuth',
          unauthorized: 'Manuale',
        },
        actions: {
          delete: 'Elimina',
          deleteConfirm: {
            title: 'Eliminare {{name}}?',
            success: 'Abbonamento {{name}} eliminato con successo',
            error: 'Impossibile eliminare l\'abbonamento {{name}}',
            content: 'Una volta eliminato, questo abbonamento non può essere recuperato. Si prega di confermare.',
            contentWithApps: 'L\'abbonamento attuale è referenziato da {{count}} applicazioni. La sua cancellazione farà sì che le applicazioni configurate smettano di ricevere gli eventi dell\'abbonamento.',
            confirm: 'Conferma eliminazione',
            cancel: 'Annulla',
            confirmInputWarning: 'Per favore inserisci il nome corretto per confermare.',
            confirmInputPlaceholder: 'Inserisci "{{name}}" per confermare.',
            confirmInputTip: 'Per favore inserisci “{{name}}” per confermare.',
          },
        },
        status: {
          active: 'Attivo',
          inactive: 'Inattivo',
        },
        usedByNum: 'Utilizzato da {{num}} flussi di lavoro',
        noUsed: 'Nessun flusso di lavoro utilizzato',
      },
    },
    addType: {
      title: 'Aggiungi abbonamento',
      description: 'Scegli come vuoi creare il tuo abbonamento al trigger',
      options: {
        apikey: {
          title: 'Crea con chiave API',
          description: 'Crea automaticamente un abbonamento utilizzando le credenziali API',
        },
        oauth: {
          title: 'Crea con OAuth',
          description: 'Autorizza con una piattaforma di terze parti per creare un abbonamento',
          clientSettings: 'Impostazioni del client OAuth',
          clientTitle: 'Client OAuth',
          default: 'Predefinito',
          custom: 'Personalizzato',
        },
        manual: {
          title: 'Configurazione manuale',
          description: 'Incolla l\'URL per creare un nuovo abbonamento',
          tip: 'Configura manualmente l\'URL sulla piattaforma di terze parti',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'Verifica',
      configuration: 'Configurazione',
    },
    common: {
      cancel: 'Annulla',
      back: 'Indietro',
      next: 'Avanti',
      create: 'Crea',
      verify: 'Verifica',
      authorize: 'Autorizzare',
      creating: 'Creazione...',
      verifying: 'Verifica in corso...',
      authorizing: 'Autorizzazione in corso...',
    },
    oauthRedirectInfo: 'Poiché non sono stati trovati segreti client di sistema per questo provider di strumenti, è necessario configurarlo manualmente; per redirect_uri, si prega di utilizzare',
    apiKey: {
      title: 'Crea con chiave API',
      verify: {
        title: 'Verifica credenziali',
        description: 'Fornisci le tue credenziali API per verificare l\'accesso',
        error: 'Verifica delle credenziali fallita. Controlla la tua chiave API.',
        success: 'Credenziali verificate con successo',
      },
      configuration: {
        title: 'Configura abbonamento',
        description: 'Imposta i parametri del tuo abbonamento',
      },
    },
    oauth: {
      title: 'Crea con OAuth',
      authorization: {
        title: 'Autorizzazione OAuth',
        description: 'Autorizza Dify ad accedere al tuo account',
        redirectUrl: 'URL di reindirizzamento',
        redirectUrlHelp: 'Utilizza questo URL nella configurazione della tua app OAuth',
        authorizeButton: 'Autorizza con {{provider}}',
        waitingAuth: 'In attesa di autorizzazione...',
        authSuccess: 'Autorizzazione riuscita',
        authFailed: 'Impossibile ottenere le informazioni di autorizzazione OAuth',
        waitingJump: 'Autorizzato, in attesa del salto',
      },
      configuration: {
        title: 'Configura abbonamento',
        description: 'Configura i parametri del tuo abbonamento dopo l\'autorizzazione',
        success: 'Configurazione OAuth completata con successo',
        failed: 'Configurazione OAuth non riuscita',
      },
      remove: {
        success: 'Rimozione di OAuth riuscita',
        failed: 'Rimozione OAuth fallita',
      },
      save: {
        success: 'Configurazione OAuth salvata con successo',
      },
    },
    manual: {
      title: 'Configurazione manuale',
      description: 'Configura manualmente il tuo abbonamento al webhook',
      logs: {
        title: 'Registro delle richieste',
        request: 'Richiesta',
        loading: 'In attesa della richiesta da {{pluginName}}...',
      },
    },
    form: {
      subscriptionName: {
        label: 'Nome dell\'abbonamento',
        placeholder: 'Inserisci il nome dell\'abbonamento',
        required: 'Il nome dell\'abbonamento è obbligatorio',
      },
      callbackUrl: {
        label: 'URL di richiamata',
        description: 'Questa URL riceverà eventi webhook',
        tooltip: 'Fornire un endpoint accessibile pubblicamente che possa ricevere richieste di callback dal fornitore del trigger.',
        placeholder: 'Generazione...',
        privateAddressWarning: 'Questo URL sembra essere un indirizzo interno, il che potrebbe causare il fallimento delle richieste webhook. Puoi modificare TRIGGER_URL con un indirizzo pubblico.',
      },
    },
    errors: {
      createFailed: 'Impossibile creare l\'abbonamento',
      verifyFailed: 'Impossibile verificare le credenziali',
      authFailed: 'Autorizzazione fallita',
      networkError: 'Errore di rete, riprova',
    },
  },
  events: {
    title: 'Eventi disponibili',
    description: 'Eventi a cui questo plugin trigger può iscriversi',
    empty: 'Nessun evento disponibile',
    event: 'Evento',
    events: 'Eventi',
    actionNum: '{{num}} {{event}} INCLUSO',
    item: {
      parameters: 'parametri {{count}}',
      noParameters: 'Nessun parametro',
    },
    output: 'Uscita',
  },
  node: {
    status: {
      warning: 'Disconnetti',
    },
  },
}

export default translation

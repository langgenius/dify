const translation = {
  subscription: {
    title: 'Naročnine',
    listNum: '{{num}} naročnine',
    empty: {
      title: 'Brez naročnin',
      button: 'Nova naročnina',
    },
    createButton: {
      oauth: 'Nova naročnina z OAuth',
      apiKey: 'Nova naročnina z API ključem',
      manual: 'Prilepite URL za ustvarjanje novega naročniškega paketa',
    },
    createSuccess: 'Naročnina je bila uspešno ustvarjena',
    createFailed: 'Ustvarjanje naročnine ni uspelo',
    maxCount: 'Največ {{num}} naročnin',
    selectPlaceholder: 'Izberite naročnino',
    noSubscriptionSelected: 'Nobena naročnina ni izbrana',
    subscriptionRemoved: 'Naročnina odstranjena',
    list: {
      title: 'Naročnine',
      addButton: 'Dodaj',
      tip: 'Prejemajte dogodke prek naročnine',
      item: {
        enabled: 'Omogočeno',
        disabled: 'Onemogočeno',
        credentialType: {
          api_key: 'API ključ',
          oauth2: 'OAuth',
          unauthorized: 'Priročnik',
        },
        actions: {
          delete: 'Izbriši',
          deleteConfirm: {
            title: 'Izbrišem {{name}}?',
            success: 'Naročnina {{name}} je bila uspešno izbrisana',
            error: 'Brisanje naročnine {{name}} ni uspelo',
            content: 'Ko bo ta naročnina izbrisana, je ne bo mogoče obnoviti. Prosimo, potrdite.',
            contentWithApps: 'Trenutno naročnino uporablja {{count}} aplikacij. Njeno brisanje bo povzročilo, da konfigurirane aplikacije ne bodo več prejemale dogodkov naročnine.',
            confirm: 'Potrdi izbris',
            cancel: 'Prekliči',
            confirmInputWarning: 'Prosimo, vnesite pravilno ime za potrditev.',
            confirmInputPlaceholder: 'Vnesite "{{name}}" za potrditev.',
            confirmInputTip: 'Prosimo vnesite “{{name}}”, da potrdite.',
          },
        },
        status: {
          active: 'Aktiven',
          inactive: 'Neaktiven',
        },
        usedByNum: 'Uporabljajo {{num}} delovni tokovi',
        noUsed: 'Brez uporabljenega poteka dela',
      },
    },
    addType: {
      title: 'Dodaj naročnino',
      description: 'Izberite, kako želite ustvariti svojo naročnino na sprožilec',
      options: {
        apikey: {
          title: 'Ustvari z API ključem',
          description: 'Samodejno ustvarite naročnino z uporabo API poverilnic',
        },
        oauth: {
          title: 'Ustvari z OAuth',
          description: 'Pooblasti tretjo stran za ustvarjanje naročnine',
          clientSettings: 'Nastavitve odjemalca OAuth',
          clientTitle: 'OAuth odjemalec',
          default: 'Privzeto',
          custom: 'Po meri',
        },
        manual: {
          title: 'Ročna nastavitev',
          description: 'Prilepite URL za ustvarjanje novega naročniškega paketa',
          tip: 'Ročno nastavite URL na platformi tretje osebe',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'Preveri',
      configuration: 'Konfiguracija',
    },
    common: {
      cancel: 'Prekliči',
      back: 'Nazaj',
      next: 'Naslednji',
      create: 'Ustvari',
      verify: 'Preveri',
      authorize: 'Pooblastiti',
      creating: 'Ustvarjanje...',
      verifying: 'Preverjanje...',
      authorizing: 'Avtorizacija...',
    },
    oauthRedirectInfo: 'Ker za tega ponudnika orodja niso bili najdeni sistemski odjemalski ključni podatki, je potrebno nastaviti ročno, za redirect_uri uporabite',
    apiKey: {
      title: 'Ustvari z API ključem',
      verify: {
        title: 'Preveri poverilnice',
        description: 'Prosimo, vnesite svoje API poverilnice za preverjanje dostopa',
        error: 'Preverjanje poverilnic ni uspelo. Prosimo, preverite svoj API ključ.',
        success: 'Poverilnice so bile uspešno preverjene',
      },
      configuration: {
        title: 'Konfiguriraj naročnino',
        description: 'Nastavite parametre naročnine',
      },
    },
    oauth: {
      title: 'Ustvari z OAuth',
      authorization: {
        title: 'OAuth avtorizacija',
        description: 'Dovoli Difyju dostop do vašega računa',
        redirectUrl: 'Preusmeritveni URL',
        redirectUrlHelp: 'Uporabite ta URL v konfiguraciji vaše OAuth aplikacije',
        authorizeButton: 'Avtorizirajte z {{provider}}',
        waitingAuth: 'Čakanje na avtorizacijo...',
        authSuccess: 'Pooblastilo uspešno',
        authFailed: 'Ni uspelo pridobiti informacij o OAuth pooblastilu',
        waitingJump: 'Pooblaščeno, čakajoč na skok',
      },
      configuration: {
        title: 'Konfiguriraj naročnino',
        description: 'Nastavite parametre naročnine po avtorizaciji',
        success: 'OAuth konfiguracija uspešna',
        failed: 'Konfiguracija OAuth je spodletela',
      },
      remove: {
        success: 'OAuth uspešno odstranjen',
        failed: 'Odstranjevanje OAuth ni uspelo',
      },
      save: {
        success: 'Konfiguracija OAuth je bila uspešno shranjena',
      },
    },
    manual: {
      title: 'Ročna nastavitev',
      description: 'Ročno konfigurirajte naročnino na spletni kavelj',
      logs: {
        title: 'Dnevniki zahtev',
        request: 'Zahteva',
        loading: 'Čakam na zahtevo od {{pluginName}}...',
      },
    },
    form: {
      subscriptionName: {
        label: 'Ime naročnine',
        placeholder: 'Vnesite ime naročnine',
        required: 'Ime naročnine je obvezno',
      },
      callbackUrl: {
        label: 'URL za povratni klic',
        description: 'Ta URL bo prejel dogodke webhook',
        tooltip: 'Zagotovite javno dostopen konec, ki lahko prejema klicne zahteve od ponudnika sprožilca.',
        placeholder: 'Generiranje...',
        privateAddressWarning: 'Ta URL se zdi notranji naslov, kar lahko povzroči, da zahtevki webhooka ne uspejo. Lahko spremenite TRIGGER_URL v javni naslov.',
      },
    },
    errors: {
      createFailed: 'Ustvarjanje naročnine ni uspelo',
      verifyFailed: 'Neuspešno preverjanje poverilnic',
      authFailed: 'Avtorizacija ni uspela',
      networkError: 'Napaka v omrežju, poskusite znova',
    },
  },
  events: {
    title: 'Razpoložljivi dogodki',
    description: 'Dogodki, na katere se lahko ta vtičnik sprožilnika naroči',
    empty: 'Ni razpoložljivih dogodkov',
    event: 'Dogodek',
    events: 'Dogodki',
    actionNum: '{{num}} {{event}} VKLJUČENO',
    item: {
      parameters: '{{count}} parametri',
      noParameters: 'Brez parametrov',
    },
    output: 'Izhod',
  },
  node: {
    status: {
      warning: 'Prekini povezavo',
    },
  },
}

export default translation

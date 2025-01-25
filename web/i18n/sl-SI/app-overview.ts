const translation = {
  welcome: {
    firstStepTip: 'Začnite s tem, da',
    enterKeyTip: 'vnesete svoj OpenAI API ključ spodaj',
    getKeyTip: 'Pridobite svoj API ključ na nadzorni plošči OpenAI',
    placeholder: 'Vaš OpenAI API ključ (npr. sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'Uporabljate {{providerName}} poskusno kvoto.',
        description: 'Poskusna kvota je namenjena vašemu testiranju. Preden se kvota izčrpa, nastavite lastnega ponudnika modela ali kupite dodatno kvoto.',
      },
      exhausted: {
        title: 'Vaša poskusna kvota je bila porabljena, nastavite API ključ.',
        description: 'Porabili ste svojo poskusno kvoto. Prosimo, nastavite lastnega ponudnika modela ali kupite dodatno kvoto.',
      },
    },
    selfHost: {
      title: {
        row1: 'Za začetek,',
        row2: 'najprej nastavite svojega ponudnika modela.',
      },
    },
    callTimes: 'Število klicev',
    usedToken: 'Porabljeni žetoni',
    setAPIBtn: 'Pojdi na nastavitev ponudnika modela',
    tryCloud: 'Ali preizkusite oblačno različico Dify s prosto kvoto',
  },
  overview: {
    title: 'Pregled',
    appInfo: {
      explanation: 'Pripravljena AI spletna aplikacija',
      accessibleAddress: 'Javni URL',
      preview: 'Predogled',
      regenerate: 'Ustvari ponovno',
      regenerateNotice: 'Ali želite ponovno ustvariti javni URL?',
      preUseReminder: 'Pred nadaljevanjem omogočite spletno aplikacijo.',
      settings: {
        entry: 'Nastavitve',
        title: 'Nastavitve spletne aplikacije',
        webName: 'Ime spletne aplikacije',
        webDesc: 'Opis spletne aplikacije',
        webDescTip: 'Besedilo bo prikazano na strani za stranke in bo zagotavljalo osnovna navodila za uporabo aplikacije',
        webDescPlaceholder: 'Vnesite opis spletne aplikacije',
        language: 'Jezik',
        workflow: {
          title: 'Potek dela',
          subTitle: 'Podrobnosti poteka dela',
          show: 'Prikaži',
          hide: 'Skrij',
          showDesc: 'Pokažite ali skrijte podrobnosti poteka dela v spletni aplikaciji',
        },
        chatColorTheme: 'Barvna tema klepeta',
        chatColorThemeDesc: 'Nastavite barvno temo klepetalnega bota',
        chatColorThemeInverted: 'Inverzna',
        invalidHexMessage: 'Neveljavna vrednost heksa',
        sso: {
          label: 'SSO avtentikacija',
          title: 'SSO spletne aplikacije',
          description: 'Vsi uporabniki morajo pred uporabo spletne aplikacije opraviti prijavo preko SSO',
          tooltip: 'Za omogočitev SSO za spletno aplikacijo se obrnite na skrbnika',
        },
        more: {
          entry: 'Prikaži več nastavitev',
          copyright: 'Avtorske pravice',
          copyRightPlaceholder: 'Vnesite ime avtorja ali organizacije',
          privacyPolicy: 'Politika zasebnosti',
          privacyPolicyPlaceholder: 'Vnesite povezavo do politike zasebnosti',
          privacyPolicyTip: 'Pomaga obiskovalcem razumeti, katere podatke aplikacija zbira, glejte <privacyPolicyLink>politiko zasebnosti</privacyPolicyLink> Dify.',
          customDisclaimer: 'Prilagojena izjava o omejitvi odgovornosti',
          customDisclaimerPlaceholder: 'Vnesite prilagojeno izjavo o omejitvi odgovornosti',
          customDisclaimerTip: 'Prilagojeno izjavo o omejitvi odgovornosti bo prikazano na strani za stranke, ki bo zagotavljala dodatne informacije o aplikaciji',
          copyrightTip: 'Prikaz informacij o avtorskih pravicah v spletni aplikaciji',
          copyrightTooltip: 'Prosimo, nadgradite na paket Professional ali višji',
        },
        modalTip: 'Nastavitve spletne aplikacije na strani odjemalca.',
      },
      embedded: {
        entry: 'Vdelano',
        title: 'Vdelava na spletno stran',
        explanation: 'Izberite način vdelave klepeta na svojo spletno stran',
        iframe: 'Za dodajanje klepeta kjerkoli na vaši spletni strani dodajte to iframe v vašo HTML kodo.',
        scripts: 'Za dodajanje klepeta na spodnji desni del vaše spletne strani dodajte to kodo v vašo HTML kodo.',
        chromePlugin: 'Namestite Dify Chatbot razširitev za Chrome',
        copied: 'Kopirano',
        copy: 'Kopiraj',
      },
      qrcode: {
        title: 'Povezava QR koda',
        scan: 'Skeniraj za deljenje',
        download: 'Prenesi QR kodo',
      },
      customize: {
        way: 'način',
        entry: 'Prilagodi',
        title: 'Prilagodi AI spletno aplikacijo',
        explanation: 'Lahko prilagodite sprednji del spletne aplikacije, da ustreza vašim scenarijem in potrebam po slogu.',
        way1: {
          name: 'Forkajte kodo stranke, jo spremenite in namestite na Vercel (priporočeno)',
          step1: 'Forkajte kodo stranke in jo spremenite',
          step1Tip: 'Kliknite tukaj, da forknite izvorno kodo v svoj GitHub račun in spremenite kodo',
          step1Operation: 'Dify-WebClient',
          step2: 'Namestite na Vercel',
          step2Tip: 'Kliknite tukaj, da uvozite repozitorij v Vercel in namestite',
          step2Operation: 'Uvoz repozitorija',
          step3: 'Konfigurirajte spremenljivke okolja',
          step3Tip: 'Dodajte naslednje spremenljivke okolja v Vercel',
        },
        way2: {
          name: 'Napišite kodo na strani stranke za klic API-ja in jo namestite na strežnik',
          operation: 'Dokumentacija',
        },
      },
    },
    apiInfo: {
      title: 'API storitev v ozadju',
      explanation: 'Enostavna integracija v vašo aplikacijo',
      accessibleAddress: 'API končna točka storitve',
      doc: 'API referenca',
    },
    status: {
      running: 'V storitvi',
      disable: 'Onemogočeno',
    },
  },
  analysis: {
    title: 'Analiza',
    ms: 'ms',
    tokenPS: 'Žetoni/s',
    totalMessages: {
      title: 'Skupno število sporočil',
      explanation: 'Število dnevnih AI interakcij.',
    },
    totalConversations: {
      title: 'Skupno število pogovorov',
      explanation: 'Število dnevnih AI pogovorov; inženiring promptov/debugging izključeno.',
    },
    activeUsers: {
      title: 'Aktivni uporabniki',
      explanation: 'Unikatni uporabniki, ki sodelujejo v vprašanjih in odgovorih z AI; inženiring promptov/debugging izključeno.',
    },
    tokenUsage: {
      title: 'Poraba žetonov',
      explanation: 'Odzrcaljuje dnevno porabo žetonov jezikovnega modela za aplikacijo, uporabno za namene nadzora stroškov.',
      consumed: 'Porabljeni',
    },
    avgSessionInteractions: {
      title: 'Povprečne interakcije v seji',
      explanation: 'Število neprekinjenih komunikacij med uporabnikom in AI; za aplikacije, ki temeljijo na pogovoru.',
    },
    avgUserInteractions: {
      title: 'Povprečne interakcije uporabnika',
      explanation: 'Odzrcaljuje dnevno pogostost uporabe uporabnikov. Ta metrika odraža vezanost uporabnikov.',
    },
    userSatisfactionRate: {
      title: 'Stopnja zadovoljstva uporabnikov',
      explanation: 'Število všečkov na 1.000 sporočil. To kaže delež odgovorov, s katerimi so uporabniki zelo zadovoljni.',
    },
    avgResponseTime: {
      title: 'Povprečni odzivni čas',
      explanation: 'Čas (v ms) za obdelavo/odgovor AI; za aplikacije, ki temeljijo na besedilu.',
    },
    tps: {
      title: 'Hitrost izhoda žetonov',
      explanation: 'Merite učinkovitost LLM. Šteje hitrost izhoda žetonov od začetka zahteve do zaključka izhoda.',
    },
  },
}

export default translation

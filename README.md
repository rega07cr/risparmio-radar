# Risparmio Radar

**Live:** https://rega07cr.github.io/risparmio-radar/

Webapp statica (HTML + CSS + JavaScript, zero build, zero dipendenze) per:

1. **Offerte tech** — 101 offerte da 24 insegne (Amazon, Apple Store, MediaWorld, Unieuro, Euronics, Trony, Comet, Eprice, Drako, BPM Power, Yeppon, Monclick, GameStop, Dell, Lenovo, HP, DJI, Dyson, Decathlon, Back Market, Refurbed, Swappie, Keychron, AliExpress) con punteggio di convenienza calcolato su sconto reale vs media 90 giorni, posizione nella forbice dei prezzi, recensioni e affidabilità del venditore. Segnala i listini gonfiati. Caricamento progressivo a blocchi di 24.
   Ogni pulsante porta alla **ricerca interna del negozio giusto** (endpoint verificato in `assets/engine.js`, mappa `STORE_SEARCH`), non a Google Shopping. Ogni card ha una **miniatura**: usa `image` se il deal la fornisce, altrimenti un'anteprima generata dalla categoria del prodotto (con `onerror` che ricade sul placeholder se l'immagine non carica).
2. **Sconti verificati** — promozioni ufficiali dei negozi (link diretti, condizioni dichiarate) + archivio personale dei codici sconto testati, con voti, data dell'ultimo test e percentuale di successo. Nessun codice viene inventato.
3. **Dropshipping lab** — prodotti ordinati per opportunità, calcolo di prezzo/margine/ROAS di pareggio, e generatore di listing differenziati (Premium, Bundle, Essenziale, Eco) con export JSON.
4. **Mining lab** — misura dell'hashrate del browser, confronto di 10 monete (da Bitcoin a Firo), ricavo/costo elettrico/netto giornaliero, conto temporaneo demo e flusso di prelievo simulato.
5. **Carrello e checkout demo** — acquisti finti completi: aggiungi un'offerta al carrello, cambia quantità, vedi subtotale/spedizione (gratis sopra 49 €)/totale, compila i dati e paga con la carta di test `4242 4242 4242 4242` (validazione Luhn, scadenza e CVV). Il pagamento "va in elaborazione", poi arriva la conferma con numero d'ordine, ultime 4 cifre della carta e consegna stimata. Nessun addebito, nessuna spedizione: carrello e storico ordini restano in `localStorage` (`rr1:cart`, `rr1:orders`).
6. **MineVault** — conto bancario *simulato* in stile Revolut dentro la sezione Mining: saldo, IBAN finto, movimenti, trasferimento dal conto mining con commissioni e imposta trattenuta, prelievo demo verso il "conto reale" e simulatore di versamento. Saldo e storico stanno in `localStorage` (`rr1:vault`), quindi **sopravvivono alla chiusura della pagina**.
7. **Idee per guadagnare** — 15 attività con capitale, tempo al primo incasso, potenziale realistico, primo passo concreto e bandiere rosse.

## Avvio locale

Non serve installare nulla.

```bash
# opzione 1: apri index.html nel browser
# opzione 2: server locale (consigliato, evita restrizioni sui worker)
python -m http.server 8123 --directory risparmio-radar
# → http://localhost:8123
```

## Pubblicazione su GitHub Pages

1. Crea un repository pubblico (es. `risparmio-radar`) e carica questi file nella radice.
2. Su GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**.
3. Branch `main`, cartella `/ (root)`, salva.
4. Dopo circa un minuto: `https://<utente>.github.io/risparmio-radar/`.

Tutti i percorsi sono relativi (`assets/...`), quindi funziona anche in una sottocartella.

## Dati: cosa è reale e cosa no

| Sezione | Stato attuale | Cosa serve per dati reali |
| --- | --- | --- |
| Offerte | Istantanea indicativa del 18/11/2026 in `assets/data.js` | Amazon PA-API 5.0 (richiede account affiliato + backend/proxy: la chiave non può stare nel browser) oppure feed affiliati di altri merchant |
| Sconti | Solo link ufficiali ai negozi, nessun codice inventato | Feed coupon di un network affiliato, oppure codici inseriti e testati a mano (la UI è già pronta) |
| Dropshipping | Catalogo dimostrativo con costi/domanda stimati | API di CJ Dropshipping / Spocket / AliExpress, oppure import manuale dei tuoi fornitori |
| Prezzi crypto | Valori statici + pulsante "Aggiorna prezzi" su CoinGecko (API pubblica, senza chiave) | Un provider a pagamento se serve affidabilità e volumi alti |
| Mining | Simulazione dichiarata | Pool + wallet + exchange con KYC; nessun payout può avvenire da una pagina web |
| MineVault | Conto demo locale: IBAN finto, saldo in `localStorage`, aliquota fiscale selezionabile (0/26/33/43%) | Un conto reale richiede una banca o un EMI autorizzato: non può essere creato da una pagina statica |
| Carrello / checkout | Ordine finto salvato in locale, con carta di test e validazioni reali | Un incasso vero richiede un processore di pagamento (Stripe) e un backend per creare la sessione e ricevere il webhook |

Per aggiornare le offerte basta modificare l'array `deals` in `assets/data.js` (campi: `price`, `listPrice`, `avg90`, `min90`, `rating`, `reviews`, `shipping`). Il punteggio viene ricalcolato al volo.

## Pagamenti reali (dropshipping)

Il checkout della sezione **Carrello** è finto: accetta una carta di test, non chiama nessun provider e non salva il numero di carta (solo le ultime 4 cifre nell'ordine demo). Un sito statico non è un processore di pagamenti e non può incassare. Il percorso corretto:

- **Shopify** — store + checkout, prova gratuita poi ~39 €/mese.
- **Stripe** — checkout ospitato; serve un backend (Worker/serverless) per creare la sessione di pagamento e un webhook per gli ordini.

Commissioni e requisiti cambiano per paese e volume: verifica sempre il listino ufficiale. In Italia, per vendere in modo continuativo serve una posizione fiscale adeguata.

## MineVault: quanto resterebbe davvero

MineVault non è una banca e non custodisce denaro: è un foglio di calcolo con l'interfaccia di un conto. Il trasferimento dal conto mining applica, nell'ordine:

1. commissione di rete simulata di 0,60 €;
2. commissione MineVault dell'1% sull'importo rimanente;
3. imposta trattenuta all'ingresso, con aliquota selezionabile (0%, 26% tipica sulle plusvalenze crypto in Italia, 33% e 43% come scenari peggiori).

Il netto accreditato è quindi quello che vedresti con soldi veri in quello scenario. Le aliquote sono indicative e non sostituiscono un commercialista: il trattamento fiscale del mining dipende dalla tua situazione. Il prelievo da MineVault verso il "conto reale" applica lo 0,5% e resta anch'esso una simulazione locale.

## Mining: perché è una simulazione

Il mining da browser non è redditizio: una pagina web produce una frazione infinitesima dell'hashrate di rete e il costo elettrico supera il ricavo. Le app che promettono "mining veloce con prelievo immediato" sono tipicamente truffe o malware. Questa sezione:

- misura davvero l'hashrate SHA-256 del browser (WebCrypto, in un Web Worker);
- calcola ricavi e costi con i numeri veri della rete (hashrate, reward, block time, prezzo);
- accumula un saldo **demo** su un conto temporaneo e simula il prelievo, dichiarandolo in ogni schermata.

Per incassare davvero servono hardware, un pool con payout al tuo wallet e un exchange con KYC. Il reddito da mining va dichiarato.

## Struttura

```
risparmio-radar/
├── index.html            # tutte le sezioni, markup e testi
├── assets/
│   ├── styles.css        # design system
│   ├── data.js           # dataset (offerte, sconti, prodotti, monete, idee)
│   ├── engine.js         # punteggi, margini, listing, economia del mining
│   └── app.js            # UI, filtri, localStorage, worker di misura
└── README.md
```

## Privacy

Nessun server, nessun analytics, nessuna chiamata di rete tranne:
- Google Fonts (tipografia);
- CoinGecko, solo quando premi "Aggiorna prezzi";
- i link che apri tu.

Codici sconto, checklist pagamenti, saldo demo, richieste di prelievo, conto MineVault, carrello e ordini demo restano in `localStorage` sul tuo dispositivo: nessuno di questi dati viene inviato da nessuna parte, e i dati di pagamento non vengono mai salvati.

## Limiti dichiarati

- I prezzi del catalogo non sono live: servono API con chiavi tue.
- Le percentuali di sconto dei negozi cambiano senza preavviso.
- I margini dropshipping sono stime: ads, resi e tasse possono azzerarli.
- Il mining è simulato e non produce denaro reale.
- Nessuna delle sezioni è consulenza finanziaria o fiscale.

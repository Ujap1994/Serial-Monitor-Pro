// Serial Monitor Pro – project website: language, theme, screenshot tabs and
// direct download links from the latest GitHub release. The page works without
// this script; every download link then opens the release page.

const REPO = 'Ujap1994/Serial-Monitor-Pro';
const GUIDE_URL = `https://github.com/${REPO}`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const LANG_KEY = 'smp-site-lang';
const THEME_KEY = 'smp-site-theme';
const RELEASE_KEY = 'smp-site-release';

// German texts for every element with data-i18n, data-i18n-html or
// data-i18n-attr. The English texts are read from the page itself.
const DE = {
  skip: 'Zum Inhalt springen',
  navLabel: 'Hauptnavigation',
  navFeatures: 'Funktionen',
  navScreenshots: 'Screenshots',
  navDownload: 'Download',
  navGuide: 'Anleitung',
  themeToggle: 'Zwischen hellem und dunklem Design wechseln',
  eyebrow: 'Kostenlos & Open Source · MIT-Lizenz',
  lead: 'Das moderne serielle Terminal für Maker, Service und Prüftechnik.',
  heroText:
    'Statt eines rohen Zeichenstroms zeigt Serial Monitor Pro Struktur: Hexdump mit ASCII-Spalte, dekodierte Protokolle, geprüfte Telegramme und Messwerte als Live-Diagramm – zehn Werkzeuge in einem Fenster.',
  source: 'Quellcode auf GitHub',
  heroMeta: 'Windows 10/11 · macOS 11+ · Linux — x64 und arm64',
  heroShotAlt:
    'Der Monitor von Serial Monitor Pro mit Zeitstempeln, Zeit zwischen den Zeilen und Schnellbefehlen',
  statsLabel: 'Auf einen Blick',
  statCrc: 'CRC-Algorithmen, geprüft gegen die offiziellen Prüfwerte',
  statProtocols: 'Protokoll-Decoder: Modbus RTU, Modbus ASCII, NMEA 0183',
  statPorts: 'serielle Ports gleichzeitig, mit Brücke zwischen zweien davon',
  statPackages: 'Pakete für Windows, macOS und Linux auf x64 und arm64',
  featuresTitle: 'Alles für die serielle Schnittstelle',
  featuresText: 'Zehn Werkzeuge in einem Fenster – vom ersten Byte bis zum geprüften Telegramm.',
  fMonitor: 'Monitor',
  fMonitorText:
    'ASCII, HEX, DEC und BIN mit Zeitstempeln, Δt zwischen den Zeilen, Hexdump, ANSI-Farben und Filter mit Hervorhebung. Senden mit automatischer CRC, Header, Footer und periodischer Wiederholung – mit bytegenauer Vorschau.',
  fTerminal: 'Terminal-Ansicht',
  fTerminalText:
    'Ein echtes VT-Terminal für Gerätekonsolen wie ESP-IDF, Zephyr, U-Boot und Linux: Farben, Cursorbewegung, Fortschrittsbalken – jede Taste geht direkt an das Gerät.',
  fCapture: 'Mitschnitt & Wiedergabe',
  fCaptureText:
    'Jedes Byte einer Sitzung mit Richtung und Zeit mitschneiden und als simuliertes Gerät abspielen, das wie das Original antwortet. Arbeiten und testen ohne Hardware.',
  fProtocol: 'Protokoll-Decoder',
  fProtocolText:
    'Modbus RTU, Modbus ASCII und NMEA 0183 mit Prüfsummenkontrolle – live oder aus einer Testeingabe, mit Paketliste, Details, Statistik und CSV-Export.',
  fFrames: 'Frame-Parser',
  fFramesText:
    'Eigenes Telegramm beschreiben – Header, Längenfeld, Nutzdaten, CRC, Footer – und empfangene Daten werden laufend zerlegt und geprüft.',
  fCrc: 'CRC-Werkzeuge',
  fCrcText:
    '11 Algorithmen von CRC-8 bis CRC-32C. Bytereihenfolge, vorzeichenbehaftete Position und Header/Footer beim Senden, dazu ein unabhängiger Rechner.',
  fGraph: 'Live-Diagramm',
  fGraphText:
    'Zeichnet Zahlen aus Zeilen wie <code>Temp:23.5, Pressure:1013</code> – oder mit eigenem regulärem Ausdruck je Kanal – in wählbaren Farben, mit Statistik und CSV-Export.',
  fMulti: 'Multi-Port',
  fMultiText:
    'Bis zu vier weitere Ports parallel mithören – farbig in einer Ansicht oder ein Bereich je Port, mit Bytezählern und einer Brücke zwischen zwei Ports.',
  fAutomation: 'Automatisierung',
  fAutomationText:
    'Abläufe aus Senden-, Warten- und Erwarten-Schritten, Makroaufzeichnung, Trigger, die auf empfangene Muster antworten, und ein Zeitplaner für zeitgesteuertes Senden.',
  fPresets: 'Presets, Sequenzen & Sende-Tabelle',
  fPresetsText:
    'Häufige Befehle einmal speichern – mit angehängter CRC, Beschreibung, eigenem Intervall und Schrittfolgen – und per Klick oder nacheinander senden.',
  fStop: 'Stopp-Bedingung',
  fStopText:
    'Eine Aufzeichnung automatisch beenden – bei einem Muster, nach <i>n</i> Bytes oder Zeilen oder nach einer Zeit – und dann anhalten, das Log als CSV speichern oder trennen.',
  fBaud: 'Baudraten-Suche & Auto-Reconnect',
  fBaudText:
    'Findet die Baudrate mit lesbarem Text von selbst und verbindet automatisch neu, wenn ein Gerät abgezogen oder zurückgesetzt wird.',
  featureExtra:
    'Außerdem: helles und dunkles Design · Englisch und Deutsch · Tastenkürzel · Zeilenzusammensetzung · Flusssteuerung und DTR/RTS · Dateien senden · Import aus der früheren Python-Version.',
  shotsTitle: 'So sieht es aus',
  shotsText:
    'Alle Bilder entstanden mit den eingebauten simulierten Geräten. Die nummerierten Markierungen passen zu den Erklärungen der (englischen) Anleitung.',
  shotDark: 'Dunkles Design',
  shotGuide: 'Diesen Teil der Anleitung lesen (Englisch)\u00a0→',
  simTitle: 'Keine Hardware zur Hand?',
  simText:
    'Aktiviere <b>Einstellungen → Simulierte Testgeräte anzeigen</b>. Mit den virtuellen Geräten probierst du jede Funktion ohne ein einziges Kabel aus – und aufgezeichnete Sitzungen werden zu weiteren simulierten Ports, die wie das echte Gerät antworten.',
  simLoopback: 'Loopback-Stecker',
  simSensor: 'Temperatur, Luftfeuchte, Luftdruck',
  simModbus: 'Modbus-RTU-Slave',
  simGps: 'GPS-Empfänger mit NMEA 0183',
  simFrames: 'Binärtelegramme mit CRC-8',
  simReplay: 'deine aufgezeichnete Sitzung',
  downloadTitle: 'Download',
  downloadText:
    'Kostenlos für jede Plattform – Pakete für x64 (Intel/AMD) und arm64 (Apple Silicon, Snapdragon, Raspberry Pi 4/5).',
  pkgInstaller: 'Installationsprogramm',
  pkgPortable: 'Portabel (ohne Installation)',
  reqMac: 'macOS 11 oder neuer',
  reqLinux: 'Debian, Ubuntu, Fedora, Arch und mehr',
  pkgAnyDistro: 'jede Distribution',
  pkgSnap: 'Distributionen mit snapd',
  pkgArchive: 'Archiv',
  checksum: 'Downloads prüfen mit',
  noteWinTitle: 'Windows: „Der Computer wurde durch Windows geschützt“',
  noteWinText:
    'Das Installationsprogramm ist nicht mit einem kostenpflichtigen Code-Signing-Zertifikat signiert. Klicke auf <b>Weitere Informationen → Trotzdem ausführen</b>.',
  noteMacTitle:
    'macOS: „kann nicht geöffnet werden, da der Entwickler nicht verifiziert werden kann“',
  noteMacText:
    'Die App ist ad hoc signiert, aber nicht von Apple notarisiert. Rechtsklick auf die App → <b>Öffnen</b> → <b>Öffnen</b>, oder einmalig ausführen:',
  noteLinuxTitle: 'Linux: „Permission denied“ beim Verbinden',
  noteLinuxText:
    'Dein Benutzer muss Mitglied der Gruppe sein, der die seriellen Ports gehören – <code>dialout</code> unter Debian, Ubuntu und Fedora, <code>uucp</code> unter Arch. Danach ab- und wieder anmelden.',
  installGuide:
    'Vollständige Installationsanleitung, Treiber und Snap-Berechtigungen (Englisch)\u00a0→',
  disclaimerTitle: 'Haftungsausschluss',
  disclaimerText:
    'Serial Monitor Pro ist ein Open-Source-Projekt, wird ohne jede Gewährleistung bereitgestellt und kann Fehler enthalten. Alles, was die Anwendung anzeigt – empfangene Daten, dekodierte Werte, Prüfsummen, Messwerte – kann falsch sein. Prüfe wichtige Ergebnisse unabhängig und verlasse dich nicht auf die Software, wo ein Fehler Menschen, Maschinen, Anlagen oder Daten gefährden könnte.',
  reportBug: 'Fehler gefunden? Auf GitHub melden\u00a0→',
  mitLicence: 'MIT-Lizenz',
  footerNav: 'Projekt',
  releases: 'Versionen',
  changelog: 'Änderungen',
  issues: 'Fehler melden',
  security: 'Sicherheit',
};

// Texts the script writes itself.
const TEXT = {
  en: {
    title: 'Serial Monitor Pro – the modern serial terminal',
    download: 'Download',
    downloadFor: 'Download for {os}',
    subWindows: 'Installer · {arch}',
    subMac: 'Universal DMG · Intel & Apple Silicon',
    subLinux: 'AppImage · deb · rpm · pacman · Flatpak · Snap',
    subAny: 'Windows · macOS · Linux',
    release: 'Latest release: {tag} from {date}',
    notes: 'Release notes',
    switchTo: 'Deutsch',
  },
  de: {
    title: 'Serial Monitor Pro – das moderne serielle Terminal',
    download: 'Herunterladen',
    downloadFor: 'Download für {os}',
    subWindows: 'Installationsprogramm · {arch}',
    subMac: 'Universal-DMG · Intel & Apple Silicon',
    subLinux: 'AppImage · deb · rpm · pacman · Flatpak · Snap',
    subAny: 'Windows · macOS · Linux',
    release: 'Aktuelle Version: {tag} vom {date}',
    notes: 'Versionshinweise',
    switchTo: 'English',
  },
};

// Release asset names look like SerialMonitorPro-1.4.0-linux-x86_64.AppImage;
// the architecture is spelled differently per package format.
const ARCH = {
  x64: '(?:x64|x86_64|amd64)',
  arm64: '(?:arm64|aarch64)',
  universal: 'universal',
};
const FORMATS = {
  'win-setup': (a) => `windows-${a}-setup\\.exe`,
  'win-portable': (a) => `windows-${a}-portable\\.exe`,
  'mac-dmg': (a) => `macos-${a}\\.dmg`,
  'mac-zip': (a) => `macos-${a}\\.zip`,
  appimage: (a) => `linux-${a}\\.AppImage`,
  deb: (a) => `linux-${a}\\.deb`,
  rpm: (a) => `linux-${a}\\.rpm`,
  pacman: (a) => `linux-${a}\\.pacman`,
  flatpak: (a) => `linux-${a}\\.flatpak`,
  snap: (a) => `linux-${a}\\.snap`,
  'tar.gz': (a) => `linux-${a}\\.tar\\.gz`,
};

const state = {
  lang: 'en',
  os: detectOs(),
  arch: 'x64',
  release: null,
};

const EN = {};

function storageGet(store, key) {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(store, key, value) {
  try {
    store.setItem(key, value);
  } catch {
    /* storage blocked – the choice simply is not remembered */
  }
}

function format(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
}

function t(key) {
  return TEXT[state.lang][key] ?? TEXT.en[key];
}

// ---------- Language ----------

function collectEnglish() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    EN[el.dataset.i18n] ??= el.textContent.replace(/[ \t\r\n]+/g, ' ').trim();
  }
  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    EN[el.dataset.i18nHtml] ??= el.innerHTML.replace(/[ \t\r\n]+/g, ' ').trim();
  }
  for (const el of document.querySelectorAll('[data-i18n-attr]')) {
    const [attr, key] = el.dataset.i18nAttr.split(':');
    EN[key] ??= el.getAttribute(attr) ?? '';
  }
}

function translate(key) {
  return (state.lang === 'de' ? DE[key] : undefined) ?? EN[key] ?? '';
}

function applyLanguage() {
  document.documentElement.lang = state.lang;
  document.title = t('title');
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = translate(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = translate(el.dataset.i18nHtml);
  }
  for (const el of document.querySelectorAll('[data-i18n-attr]')) {
    const [attr, key] = el.dataset.i18nAttr.split(':');
    el.setAttribute(attr, translate(key));
  }
  const toggle = document.getElementById('lang-toggle');
  toggle.textContent = state.lang === 'de' ? 'EN' : 'DE';
  toggle.setAttribute('aria-label', t('switchTo'));
  toggle.title = t('switchTo');
  syncGalleryAlt();
  renderDownloads();
}

function initialLanguage() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl === 'de' || fromUrl === 'en') return fromUrl;
  const saved = storageGet(localStorage, LANG_KEY);
  if (saved === 'de' || saved === 'en') return saved;
  const preferred = navigator.languages?.[0] ?? navigator.language ?? 'en';
  return preferred.toLowerCase().startsWith('de') ? 'de' : 'en';
}

// ---------- Theme ----------

function currentTheme() {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  storageSet(localStorage, THEME_KEY, next);
}

// ---------- Screenshot tabs ----------

function syncGalleryAlt() {
  const selected = document.querySelector('.gallery-tabs [aria-selected="true"]');
  if (selected) document.getElementById('gallery-image').alt = selected.textContent.trim();
}

function selectTab(tab, focus) {
  for (const other of document.querySelectorAll('.gallery-tabs [role="tab"]')) {
    const active = other === tab;
    other.setAttribute('aria-selected', String(active));
    other.tabIndex = active ? 0 : -1;
  }
  const image = document.getElementById('gallery-image');
  image.src = tab.dataset.src;
  document.getElementById('gallery-guide').href = GUIDE_URL + tab.dataset.guide;
  syncGalleryAlt();
  if (focus) tab.focus();
}

function initGallery() {
  const tabs = [...document.querySelectorAll('.gallery-tabs [role="tab"]')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab, false));
    tab.addEventListener('keydown', (event) => {
      const index = tabs.indexOf(tab);
      const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      let next = null;
      if (event.key in moves) next = tabs[(index + moves[event.key] + tabs.length) % tabs.length];
      if (event.key === 'Home') next = tabs[0];
      if (event.key === 'End') next = tabs[tabs.length - 1];
      if (next) {
        event.preventDefault();
        selectTab(next, true);
      }
    });
  }
}

// ---------- Downloads ----------

function detectOs() {
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator.userAgentData?.platform ?? navigator.platform ?? '').toLowerCase();
  if (/android|iphone|ipad|ipod/.test(ua)) return null;
  if (platform.includes('win') || ua.includes('windows')) return 'windows';
  if (platform.includes('mac') || ua.includes('mac os')) {
    // iPadOS reports itself as a Mac – but has a touch screen.
    return navigator.maxTouchPoints > 1 ? null : 'macos';
  }
  if (platform.includes('linux') || ua.includes('linux')) return 'linux';
  return null;
}

async function detectArch() {
  if (/arm64|aarch64/.test(navigator.userAgent.toLowerCase())) return 'arm64';
  try {
    const data = await navigator.userAgentData?.getHighEntropyValues(['architecture']);
    if (data?.architecture === 'arm') return 'arm64';
  } catch {
    /* not available in this browser */
  }
  return 'x64';
}

function findAsset(formatName, arch) {
  const pattern = FORMATS[formatName];
  if (!pattern || !state.release || !ARCH[arch]) return null;
  const re = new RegExp(`-${pattern(ARCH[arch])}$`);
  return state.release.assets.find((asset) => re.test(asset.name)) ?? null;
}

function megabytes(bytes) {
  return `${Math.round(bytes / 1048576)} MB`;
}

function renderPackageLinks() {
  if (!state.release) return;
  for (const link of document.querySelectorAll('a.pkg[data-format]')) {
    const asset = findAsset(link.dataset.format, link.dataset.arch);
    link.querySelector('.size')?.remove();
    link.classList.toggle('is-missing', !asset);
    if (!asset) {
      link.href = state.release.html_url;
      continue;
    }
    link.href = asset.browser_download_url;
    link.title = asset.name;
    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = megabytes(asset.size);
    link.append(size);
  }
  const sums = state.release.assets.find((asset) => asset.name === 'SHA256SUMS.txt');
  document.getElementById('checksums').href = sums
    ? sums.browser_download_url
    : state.release.html_url;
}

function renderReleaseInfo() {
  const info = document.getElementById('release-info');
  if (!state.release) return;
  const date = new Intl.DateTimeFormat(state.lang === 'de' ? 'de-DE' : 'en-GB', {
    dateStyle: 'long',
  }).format(new Date(state.release.published_at));
  const text = format(t('release'), { tag: state.release.tag_name, date });
  const link = document.createElement('a');
  link.href = state.release.html_url;
  link.textContent = t('notes');
  info.replaceChildren(`${text} · `, link);
  info.hidden = false;
}

function renderHeroButton() {
  const button = document.getElementById('hero-download');
  const title = document.getElementById('hero-download-title');
  const sub = document.getElementById('hero-download-sub');
  const version = state.release ? `${state.release.tag_name} · ` : '';
  const names = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

  if (!state.os) {
    title.textContent = t('download');
    sub.textContent = t('subAny');
    button.href = '#download';
    return;
  }
  title.textContent = format(t('downloadFor'), { os: names[state.os] });

  if (state.os === 'linux') {
    sub.textContent = t('subLinux');
    button.href = '#download-linux';
    return;
  }
  const asset =
    state.os === 'windows' ? findAsset('win-setup', state.arch) : findAsset('mac-dmg', 'universal');
  const label =
    state.os === 'windows' ? format(t('subWindows'), { arch: state.arch }) : t('subMac');
  sub.textContent = asset ? `${version}${label} · ${megabytes(asset.size)}` : label;
  button.href = asset ? asset.browser_download_url : `#download-${state.os}`;
}

function renderDownloads() {
  renderHeroButton();
  renderPackageLinks();
  renderReleaseInfo();
}

async function loadRelease() {
  const cached = storageGet(sessionStorage, RELEASE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      /* ignore a damaged cache entry */
    }
  }
  const response = await fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const data = await response.json();
  const release = {
    tag_name: data.tag_name,
    html_url: data.html_url,
    published_at: data.published_at,
    assets: (data.assets ?? []).map(({ name, size, browser_download_url }) => ({
      name,
      size,
      browser_download_url,
    })),
  };
  storageSet(sessionStorage, RELEASE_KEY, JSON.stringify(release));
  return release;
}

// ---------- Start ----------

function init() {
  collectEnglish();
  state.lang = initialLanguage();
  applyLanguage();
  initGallery();

  document.getElementById('lang-toggle').addEventListener('click', () => {
    state.lang = state.lang === 'de' ? 'en' : 'de';
    storageSet(localStorage, LANG_KEY, state.lang);
    applyLanguage();
  });
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  void detectArch().then((arch) => {
    state.arch = arch;
    renderHeroButton();
  });
  loadRelease()
    .then((release) => {
      state.release = release;
      renderDownloads();
    })
    .catch((error) => {
      // Offline or rate-limited: the links keep pointing at the release page.
      console.info('Release information unavailable:', error.message);
    });
}

init();

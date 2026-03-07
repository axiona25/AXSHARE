# AXSHARE — UI Design Specification
> **Versione:** 1.0 — Marzo 2026  
> **Scope:** Solo modifiche UI/UX — ZERO modifiche a logica, hook, API, funzionalità  
> **Font:** Plus Jakarta Sans  
> **Mood:** Light mode, clean, enterprise, premium  
> **Riferimenti visivi:** Vedi `/ui-specs/axshare-login.html` e `/ui-specs/axshare-dashboard.html`

---

## ⚠️ REGOLA FONDAMENTALE PER CURSOR

**Modifica ESCLUSIVAMENTE:**
- Classi CSS / Tailwind
- Struttura HTML/JSX visiva (layout, ordine elementi)
- Colori, font, spaziature, bordi, ombre
- Animazioni e transizioni CSS
- Icone SVG inline

**NON toccare MAI:**
- Hook React (`useState`, `useEffect`, `useCallback`, ecc.)
- Chiamate API (`fetch`, `axios`, funzioni backend)
- Logica di autenticazione (`AuthContext`, JWT, PIN, WebAuthn)
- Funzioni crypto (`useCrypto.ts`)
- Comandi Tauri (`invoke`, `listen`)
- WebDAV / disco virtuale
- SQLite / file protector
- Qualsiasi file `.rs` (Rust)
- File di configurazione (`.env`, `docker-compose`, ecc.)

---

## 1. INSTALLAZIONE FONT

### Next.js — `app/layout.tsx`
```tsx
import { Plus_Jakarta_Sans } from 'next/font/google'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  style: ['normal', 'italic'],
  variable: '--font-jakarta',
  display: 'swap',
})

export default function RootLayout({ children }) {
  return (
    <html lang="it" className={jakarta.variable}>
      <body className="font-jakarta">{children}</body>
    </html>
  )
}
```

### `tailwind.config.ts`
```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  theme: {
    extend: {
      fontFamily: {
        jakarta: ['var(--font-jakarta)', 'sans-serif'],
      },
      colors: {
        ax: {
          sky:          '#73C1F9',
          'blue-light': '#50A8F0',
          blue:         '#3299F3',
          'blue-mid':   '#1671C6',
          'blue-deep':  '#1580E6',
          'blue-dark':  '#084C8F',
          navy:         '#1E3A5F',
          'navy-700':   '#1C3E6A',
          'navy-900':   '#0D2645',
          'surface-0':  '#FFFFFF',
          'surface-1':  '#F0F7FF',
          'surface-2':  '#E4EEF8',
          border:       '#D6E4F0',
          text:         '#1E3A5F',
          muted:        '#6B87A4',
          success:      '#22C55E',
          warning:      '#F59E0B',
          error:        '#EF4444',
        }
      },
      boxShadow: {
        'ax-sm':  '0 1px 8px rgba(30,58,95,0.06)',
        'ax-md':  '0 4px 20px rgba(30,58,95,0.10)',
        'ax-lg':  '0 8px 32px rgba(30,58,95,0.14)',
        'ax-btn': '0 4px 16px rgba(50,153,243,0.35)',
        'ax-btn-hover': '0 6px 24px rgba(50,153,243,0.45)',
      },
      borderRadius: {
        'ax': '12px',
        'ax-lg': '16px',
        'ax-xl': '20px',
        'ax-2xl': '24px',
      }
    }
  }
}
export default config
```

### CSS Global — `app/globals.css`
```css
:root {
  --ax-sky:         #73C1F9;
  --ax-blue-light:  #50A8F0;
  --ax-blue:        #3299F3;
  --ax-blue-mid:    #1671C6;
  --ax-blue-deep:   #1580E6;
  --ax-blue-dark:   #084C8F;
  --ax-navy:        #1E3A5F;
  --ax-navy-700:    #1C3E6A;
  --ax-navy-900:    #0D2645;
  --ax-surface-0:   #FFFFFF;
  --ax-surface-1:   #F0F7FF;
  --ax-surface-2:   #E4EEF8;
  --ax-border:      #D6E4F0;
  --ax-text:        #1E3A5F;
  --ax-muted:       #6B87A4;
  --ax-success:     #22C55E;
  --ax-warning:     #F59E0B;
  --ax-error:       #EF4444;

  --ax-gradient-primary: linear-gradient(135deg, #3299F3 0%, #1580E6 100%);
  --ax-gradient-shield:  linear-gradient(145deg, #73C1F9 0%, #3299F3 40%, #1580E6 70%, #084C8F 100%);
  --ax-gradient-dark:    linear-gradient(180deg, #0A1628 0%, #0D2645 50%, #1C3E6A 100%);

  --sidebar-width: 220px;
  --header-height: 64px;
}

body {
  font-family: 'Plus Jakarta Sans', sans-serif;
  color: var(--ax-text);
  background: #F0F5FB;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

---

## 2. PALETTE COLORI UFFICIALE

| Token | Hex | RGB | Uso |
|-------|-----|-----|-----|
| `--ax-sky` | `#73C1F9` | 115,193,249 | Highlight, icone chiare |
| `--ax-blue-light` | `#50A8F0` | 80,168,240 | Hover states, accenti secondari |
| `--ax-blue` | `#3299F3` | 50,153,243 | **Colore primario CTA, link, active** |
| `--ax-blue-mid` | `#1671C6` | 22,113,198 | Testo link, bordi focus |
| `--ax-blue-deep` | `#1580E6` | 21,128,230 | Gradient fine, pressed states |
| `--ax-blue-dark` | `#084C8F` | 8,76,143 | Deep accent, gradient scuro |
| `--ax-navy` | `#1E3A5F` | 30,58,95 | **Testo principale, headings** |
| `--ax-navy-700` | `#1C3E6A` | 28,62,106 | Sidebar scura, bordi dark |
| `--ax-navy-900` | `#0D2645` | 13,38,69 | Card dark mode |
| `--ax-surface-0` | `#FFFFFF` | 255,255,255 | Card background, input bg focus |
| `--ax-surface-1` | `#F0F7FF` | 240,247,255 | Page bg, input default bg |
| `--ax-surface-2` | `#E4EEF8` | 228,238,248 | Hover rows, dividers, separatori |
| `--ax-border` | `#D6E4F0` | 214,228,240 | **Tutti i bordi** |
| `--ax-text` | `#1E3A5F` | 30,58,95 | Testo body |
| `--ax-muted` | `#6B87A4` | 107,135,164 | Testo secondario, placeholder |
| `--ax-success` | `#22C55E` | 34,197,94 | Stato ok, disco montato |
| `--ax-warning` | `#F59E0B` | 245,158,11 | Avvisi |
| `--ax-error` | `#EF4444` | 239,68,68 | Errori, pericolo |

### Gradienti ufficiali
```css
/* Bottoni primari */
background: linear-gradient(135deg, #3299F3 0%, #1580E6 100%);

/* Scudo logo */
background: linear-gradient(145deg, #73C1F9 0%, #3299F3 40%, #1580E6 70%, #084C8F 100%);

/* Background dark (login) */
background: linear-gradient(135deg, #EEF4FB 0%, #E0EDF8 40%, #D6E8F5 100%);
```

---

## 3. TIPOGRAFIA

### Scala tipografica

| Ruolo | Size | Weight | Color | Classe Tailwind |
|-------|------|--------|-------|-----------------|
| Display / H1 | 28–36px | 800 | `--ax-navy` | `text-3xl font-extrabold` |
| Heading H2 | 22–24px | 800 | `--ax-navy` | `text-2xl font-extrabold` |
| Heading H3 | 18px | 700 | `--ax-navy` | `text-lg font-bold` |
| Subtitle | 15px | 500 | `--ax-navy` | `text-[15px] font-medium` |
| Body | 14px | 400 | `--ax-text` | `text-sm font-normal` |
| Body small | 13px | 400–500 | `--ax-text` | `text-[13px]` |
| Label form | 13px | 600 | `--ax-navy` | `text-[13px] font-semibold` |
| Caption | 12px | 400 | `--ax-muted` | `text-xs text-ax-muted` |
| Micro | 11px | 500–600 | `--ax-muted` | `text-[11px] font-medium` |
| Badge / tag | 10–11px | 700 | variabile | `text-[11px] font-bold` |

### Regole tipografiche
- Letter-spacing heading: `-0.01em`
- Letter-spacing label uppercase: `0.1–0.14em`
- Line-height body: `1.5–1.6`
- **MAI usare** Inter, Roboto, Arial, system-ui come font principale

---

## 4. COMPONENTI UI

### 4.1 Bottone Primario
```tsx
// Classe base
className="
  flex items-center justify-content-center gap-2
  h-[50px] px-6 w-full
  bg-gradient-to-br from-ax-blue to-ax-blue-deep
  text-white text-[15px] font-bold tracking-[0.02em]
  rounded-ax border-none
  shadow-ax-btn
  transition-all duration-200
  hover:-translate-y-px hover:shadow-ax-btn-hover hover:from-ax-blue-light hover:to-ax-blue
  active:translate-y-0 active:shadow-none
  cursor-pointer
"
```

### 4.2 Bottone Secondario (outline)
```tsx
className="
  flex items-center justify-center gap-2
  h-[46px] px-5
  bg-white
  text-ax-blue text-[14px] font-semibold
  border-[1.5px] border-ax-blue rounded-ax
  transition-all duration-200
  hover:bg-ax-surface-1
  cursor-pointer
"
```

### 4.3 Bottone Ghost
```tsx
className="
  flex items-center justify-center gap-2
  h-[38px] px-4
  bg-ax-surface-1
  text-ax-muted text-[13px] font-medium
  border border-ax-border rounded-ax
  transition-all duration-150
  hover:bg-white hover:border-ax-blue-light hover:text-ax-text
  cursor-pointer
"
```

### 4.4 Input Form
```tsx
className="
  w-full h-[48px]
  pl-[44px] pr-[44px]
  bg-ax-surface-1
  border-[1.5px] border-ax-border
  rounded-ax
  text-[14px] font-normal text-ax-text
  placeholder:text-[#A8BDD0]
  outline-none
  transition-all duration-200
  focus:bg-white focus:border-ax-blue focus:shadow-[0_0_0_3px_rgba(50,153,243,0.12)]
"
```

### 4.5 Label Form
```tsx
className="block text-[13px] font-semibold text-ax-navy mb-[7px] tracking-[0.01em]"
```

### 4.6 Card
```tsx
className="
  bg-white
  border border-ax-border
  rounded-ax-lg
  shadow-ax-sm
  transition-all duration-200
  hover:shadow-ax-md
"
```

### 4.7 Card Glassmorphism (Login)
```tsx
className="
  bg-white/92
  backdrop-blur-xl
  border border-white/80
  rounded-ax-2xl
  shadow-[0_4px_6px_rgba(30,58,95,0.04),0_12px_40px_rgba(30,58,95,0.10)]
  p-10
"
```

### 4.8 Badge / Pill
```tsx
// Privato
className="inline-flex items-center gap-1 px-[9px] py-[3px] rounded-full text-[11px] font-semibold bg-ax-surface-1 text-ax-muted"

// Condiviso
className="inline-flex items-center gap-1 px-[9px] py-[3px] rounded-full text-[11px] font-semibold bg-ax-blue/10 text-ax-blue-mid"

// Team / Success
className="inline-flex items-center gap-1 px-[9px] py-[3px] rounded-full text-[11px] font-semibold bg-ax-success/10 text-green-700"

// Encrypted badge
className="inline-flex items-center gap-[6px] px-4 py-2 rounded-full text-[11px] font-semibold bg-ax-blue/[0.06] border border-ax-blue/[0.15] text-ax-blue-mid"
```

### 4.9 Tab Switcher
```tsx
// Container
className="flex bg-ax-surface-1 border border-ax-border rounded-[12px] p-1 gap-1"

// Tab inattivo
className="flex-1 py-[10px] rounded-[9px] text-[14px] font-semibold text-ax-muted bg-transparent border-none cursor-pointer transition-all duration-200"

// Tab attivo
className="flex-1 py-[10px] rounded-[9px] text-[14px] font-semibold text-ax-blue bg-white shadow-[0_1px_8px_rgba(30,58,95,0.12)] border-none cursor-pointer"
```

### 4.10 Icona bottone (header)
```tsx
className="
  w-[38px] h-[38px]
  flex items-center justify-center
  bg-ax-surface-1 border border-transparent
  rounded-ax text-ax-muted
  transition-all duration-150
  hover:bg-white hover:border-ax-border hover:text-ax-blue
  cursor-pointer
"
```

### 4.11 Nav Item Sidebar
```tsx
// Inattivo
className="
  flex items-center gap-[10px] px-3 py-[9px]
  rounded-[10px] text-[13.5px] font-medium text-ax-muted
  transition-all duration-150
  hover:bg-ax-surface-1 hover:text-ax-text
  cursor-pointer select-none relative
"

// Attivo — aggiungere anche la barra verticale sinistra
className="
  flex items-center gap-[10px] px-3 py-[9px]
  rounded-[10px] text-[13.5px] font-semibold text-ax-blue
  bg-ax-surface-1
  cursor-pointer select-none relative
  before:content-[''] before:absolute before:left-0 before:top-[20%] before:bottom-[20%]
  before:w-[3px] before:bg-ax-blue before:rounded-r-[3px]
"
```

---

## 5. LAYOUT DASHBOARD

### Struttura generale
```
┌─────────────────────────────────────────────────────┐
│  HEADER (h=64px, bg=white, border-bottom)           │
│  [Logo 220px] | [Search flex-1] | [Actions]         │
├──────────────┬──────────────────────────────────────┤
│              │                                      │
│  SIDEBAR     │  MAIN CONTENT                        │
│  w=220px     │  overflow-y: auto                    │
│  bg=white    │  padding: 28px 32px                  │
│  border-right│                                      │
│              │  [Page title]                        │
│  [Nav items] │  [Folder cards grid 5 col]           │
│              │  [File table]                        │
│  [Storage]   │                                      │
│              │                                      │
└──────────────┴──────────────────────────────────────┘
```

### CSS Layout base
```css
body { height: 100vh; overflow: hidden; display: flex; flex-direction: column; }
.header { height: 64px; flex-shrink: 0; }
.app-body { display: flex; flex: 1; overflow: hidden; }
.sidebar { width: 220px; flex-shrink: 0; overflow-y: auto; }
.main { flex: 1; overflow-y: auto; padding: 28px 32px; }
```

### Folder Cards Grid
```tsx
className="grid grid-cols-5 gap-[14px] mb-8"
// Ogni card: bg-white border border-ax-border rounded-ax-lg p-[18px_16px]
// Hover: border-ax-blue-light shadow-ax-md -translate-y-0.5
```

### File Table
```tsx
// Wrapper
className="bg-white border border-ax-border rounded-ax-lg overflow-hidden"

// Intestazione th
className="px-5 py-[10px] text-left text-[11px] font-bold uppercase tracking-[0.08em] text-ax-muted bg-[#FAFCFF] border-b border-ax-surface-2 cursor-pointer hover:text-ax-blue"

// Riga td
className="px-5 h-[52px] border-b border-ax-surface-2 text-[13px] text-ax-text align-middle"

// Riga hover
className="hover:bg-ax-surface-1 cursor-pointer transition-colors duration-100"
```

---

## 6. LAYOUT LOGIN / ONBOARDING

### Struttura
```
┌─────────────────────────────────────────────────────┐
│  BACKGROUND animato (orbs + grid sottile)           │
│                                                     │
│              ┌────────────────────┐                 │
│              │  Logo AXSHARE      │                 │
│              │  (h=52px, centrato)│                 │
│              │  tagline sotto     │                 │
│              └────────────────────┘                 │
│              ┌────────────────────┐                 │
│              │  CARD glassmorphism│                 │
│              │  max-w: 480px      │                 │
│              │  [Tab login/reg]   │                 │
│              │  [Form]            │                 │
│              └────────────────────┘                 │
│              [Footer link]                          │
│              [Badge E2E]                            │
└─────────────────────────────────────────────────────┘
```

### Background animato
```css
/* Sfondo base */
background: linear-gradient(135deg, #EEF4FB 0%, #E0EDF8 40%, #D6E8F5 100%);

/* Grid sottile sopra */
background-image:
  linear-gradient(rgba(50,153,243,0.06) 1px, transparent 1px),
  linear-gradient(90deg, rgba(50,153,243,0.06) 1px, transparent 1px);
background-size: 48px 48px;

/* Orbs (position:fixed, z-index:0, filter:blur(60px), opacity:0.45) */
/* Orb 1: 520x520px, gradient sky→blue, top-left, animato */
/* Orb 2: 380x380px, gradient blue-light→blue-deep, bottom-right */
/* Orb 3: 260x260px, gradient blue-dark→navy-700, center-right, opacity:0.2 */
```

### Animazioni entry
```css
/* Card principale */
@keyframes cardIn {
  from { opacity: 0; transform: translateY(32px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
animation: cardIn 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;

/* Logo area */
@keyframes fadeDown {
  from { opacity: 0; transform: translateY(-12px); }
  to   { opacity: 1; transform: translateY(0); }
}
animation: fadeDown 0.6s ease forwards;
animation-delay: 0.15s;
```

---

## 7. HEADER DASHBOARD

### Struttura header
```tsx
<header className="h-[64px] bg-white border-b border-ax-border flex items-center pr-5 gap-3 shadow-ax-sm sticky top-0 z-50">

  {/* Logo area — larghezza sidebar */}
  <div className="w-[220px] flex items-center px-5 gap-[10px] border-r border-ax-border h-full flex-shrink-0">
    <img src={logo} alt="AXSHARE" className="h-7 w-auto object-contain" />
    <HamburgerButton />
  </div>

  {/* Search */}
  <div className="flex-1 max-w-[540px] relative">
    <SearchIcon className="absolute left-[14px] top-1/2 -translate-y-1/2 text-ax-muted" />
    <input className="w-full h-10 bg-ax-surface-1 border-[1.5px] border-ax-border rounded-[10px] pl-[42px] pr-16 text-[13.5px] ..." />
    <span className="absolute right-3 top-1/2 -translate-y-1/2 bg-white border border-ax-border rounded px-[7px] py-[2px] text-[10px] font-semibold text-ax-muted">⌘K</span>
  </div>

  <div className="flex-1" />

  {/* Actions */}
  <UploadButton />
  <DiskToggle />
  <NotificationButton />
  <PeopleButton />
  <AvatarDropdown />

</header>
```

### Bottone Upload (header)
```tsx
className="flex items-center gap-[7px] px-4 h-[38px] bg-gradient-to-br from-ax-blue to-ax-blue-deep text-white text-[13px] font-bold rounded-[10px] shadow-ax-btn mr-1 hover:-translate-y-px hover:shadow-ax-btn-hover transition-all duration-200"
```

### Toggle Disco Virtuale
```tsx
// Default (disco smontato)
className="flex items-center gap-2 px-[14px] h-[38px] bg-ax-surface-1 border-[1.5px] border-ax-border rounded-[10px] text-[12px] font-semibold text-ax-text mr-1 hover:border-ax-blue hover:text-ax-blue hover:bg-white transition-all"

// Attivo (disco montato) — aggiungere classe .active
className="... border-ax-success text-green-700 bg-ax-success/[0.06]"
// dot: bg-ax-success shadow-[0_0_6px_rgba(34,197,94,0.5)]
```

---

## 8. SIDEBAR

```tsx
<aside className="w-[220px] bg-white border-r border-ax-border flex flex-col p-3 overflow-y-auto">

  {/* Sezione label */}
  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ax-muted px-[10px] mb-[6px] mt-4 first:mt-1">
    Principale
  </span>

  {/* Nav items */}
  <NavItem icon={<HomeIcon />} label="Home" active />
  <NavItem icon={<DriveIcon />} label="Il mio Drive" />
  
  <span className="...">Libreria</span>
  <NavItem icon={<ShareIcon />} label="Condivisi" badge={3} />
  <NavItem icon={<ClockIcon />} label="Recenti" />
  <NavItem icon={<StarIcon />} label="Speciali" />
  
  <span className="...">Altro</span>
  <NavItem icon={<TrashIcon />} label="Cestino" badge={2} badgeGray />

  {/* Footer storage */}
  <div className="mt-auto pt-4 border-t border-ax-surface-2">
    <div className="flex justify-between text-[12px] font-semibold text-ax-text mb-[6px]">
      <span>Spazio usato</span>
      <span className="text-ax-muted font-normal">56%</span>
    </div>
    <div className="h-[6px] bg-ax-surface-2 rounded-full mb-[6px] overflow-hidden">
      <div className="h-full bg-gradient-to-r from-ax-blue to-ax-blue-deep rounded-full" style={{width:'56%'}} />
    </div>
    <p className="text-[11px] text-ax-muted mb-3">56,4 GB di 100 GB usati</p>
    <button className="w-full h-9 bg-transparent border-[1.5px] border-ax-blue rounded-[9px] text-ax-blue text-[12px] font-bold hover:bg-ax-blue hover:text-white hover:shadow-ax-btn transition-all">
      Acquista altro spazio
    </button>
  </div>

</aside>
```

### Nav Badge
```tsx
// Colorato (notifiche)
<span className="ml-auto bg-ax-blue text-white text-[10px] font-bold px-[7px] py-[1px] rounded-full min-w-[20px] text-center">
  {count}
</span>

// Grigio (cestino)
<span className="ml-auto bg-ax-surface-2 text-ax-muted text-[10px] font-bold px-[7px] py-[1px] rounded-full">
  {count}
</span>
```

---

## 9. ICONE FILE

Usare icone colorate per tipo file — NON usare un'icona generica per tutto:

| Estensione | BG | Colore testo | Label |
|------------|-----|--------------|-------|
| `.xlsx`, `.xls` | `#E8F5E9` | `#2E7D32` | XLS |
| `.docx`, `.doc` | `#E3F2FD` | `#1565C0` | DOC |
| `.pdf` | `#FFEBEE` | `#C62828` | PDF |
| `.pptx`, `.ppt` | `#F3E5F5` | `#6A1B9A` | PPT |
| `.zip`, `.rar` | `#FFF8E1` | `#F57F17` | ZIP |
| `.png`, `.jpg` | `#E0F7FA` | `#00695C` | IMG |
| `.mp4`, `.mov` | `#FCE4EC` | `#880E4F` | VID |
| Cartella | `#E3F2FD` | `#1565C0` | — |
| Altro | `#F5F5F5` | `#616161` | FILE |

```tsx
// Dimensione icona file in tabella
className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[10px] font-extrabold flex-shrink-0"
```

---

## 10. MODALE UPLOAD

```tsx
{/* Overlay */}
className="fixed inset-0 bg-ax-navy/35 backdrop-blur-sm z-[500] flex items-center justify-center"

{/* Modal */}
className="bg-white rounded-ax-xl p-8 w-[440px] shadow-ax-lg animate-[modalIn_0.25s_cubic-bezier(0.16,1,0.3,1)_forwards]"

{/* Drop zone */}
className="border-2 border-dashed border-ax-border rounded-[14px] p-10 text-center cursor-pointer transition-all hover:border-ax-blue hover:bg-ax-blue/[0.04] mb-5"

{/* Badge E2E dentro modale */}
className="flex items-center gap-2 p-[10px_14px] bg-ax-blue/[0.06] border border-ax-blue/[0.15] rounded-[10px] mb-5"
```

---

## 11. TOAST / NOTIFICHE

```tsx
// Toast bottom center
className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-ax-navy text-white px-[22px] py-[11px] rounded-[12px] text-[13px] font-semibold shadow-ax-lg z-[9999] whitespace-nowrap"

// Animazione
// Entrando: opacity 0→1, translateY 16px→0
// Uscendo: opacity 1→0
// Duration: 300ms ease
// Auto-dismiss: 2800ms
```

---

## 12. OMBRE E BORDI

```css
/* Bordo standard */
border: 1px solid #D6E4F0;

/* Bordo focus input */
border: 1.5px solid #3299F3;
box-shadow: 0 0 0 3px rgba(50,153,243,0.12);

/* Card base */
box-shadow: 0 1px 8px rgba(30,58,95,0.06);

/* Card hover */
box-shadow: 0 4px 20px rgba(30,58,95,0.10);

/* Modal / dropdown */
box-shadow: 0 8px 32px rgba(30,58,95,0.14);

/* Button primary */
box-shadow: 0 4px 16px rgba(50,153,243,0.35);

/* Button primary hover */
box-shadow: 0 6px 24px rgba(50,153,243,0.45);
```

---

## 13. BORDER RADIUS

| Elemento | Valore |
|----------|--------|
| Input, bottoni piccoli, badge | `8px` (`rounded-ax`) |
| Card piccole, bottoni medi | `12px` |
| Card medie, modali sezioni | `16px` (`rounded-ax-lg`) |
| Card grandi | `20px` (`rounded-ax-xl`) |
| Card login glassmorphism | `24px` (`rounded-ax-2xl`) |
| Badge / pill | `9999px` (`rounded-full`) |
| Barra storage | `9999px` (`rounded-full`) |

---

## 14. SPAZIATURE RICORRENTI

```css
/* Padding card */
padding: 18px 16px;   /* folder card */
padding: 28px 32px;   /* main content */
padding: 40px 44px;   /* login card */

/* Gap griglia cartelle */
gap: 14px;

/* Gap lista file (row height) */
height: 52px;

/* Sidebar padding */
padding: 16px 12px;

/* Header padding */
padding: 0 20px 0 0;

/* Margin sezione */
margin-bottom: 32px;
```

---

## 15. PAGINA LOGIN — CHECKLIST IMPLEMENTAZIONE

- [ ] Sfondo: gradiente `#EEF4FB → #E0EDF8 → #D6E8F5` + grid pattern 48px
- [ ] 3–4 orb animati con `blur(60px)`, `opacity: 0.35–0.45`
- [ ] Logo AXSHARE centrato, `height: 52px`, `drop-shadow` blu
- [ ] Tagline sotto logo: `text-[12px] font-medium text-ax-muted`
- [ ] Card max-w `480px`, glassmorphism `bg-white/92 backdrop-blur-xl`
- [ ] Tab switcher Login / Registrati
- [ ] Campo Email con icona sinistra SVG
- [ ] Campo Password con icona sinistra + toggle mostra/nascondi destra
- [ ] Checkbox "Ricordami" custom (NON il default HTML)
- [ ] Link "Password dimenticata?" allineato a destra
- [ ] Bottone Accedi full-width con gradient + shine effect hover
- [ ] Divider "oppure continua con"
- [ ] Bottone Passkey outline
- [ ] Form Register: Nome+Cognome affiancati, Email, Password con strength meter, Conferma
- [ ] Strength meter: 5 livelli (rosso → arancio → arancio → blu → verde)
- [ ] Badge "Crittografia End-to-End RSA-4096 · AES-256-GCM" sotto la card
- [ ] Animazioni entry: `cardIn`, `fadeDown`, `fadeUp` con delay scalati
- [ ] Validazione visiva: bordo rosso + messaggio errore inline
- [ ] Toast feedback azioni

---

## 16. DASHBOARD — CHECKLIST IMPLEMENTAZIONE

- [ ] Header sticky `z-50`, `height: 64px`, `bg-white`, `border-bottom`
- [ ] Logo in area fissa `220px` con `border-right`
- [ ] Search bar con icona, placeholder, shortcut `⌘K`
- [ ] Bottone "Carica" con gradiente e icona upload
- [ ] Toggle "Disco virtuale" con dot animato (grigio/verde)
- [ ] Notifiche con badge rosso pulsante
- [ ] Avatar con dropdown (Profilo / Impostazioni / Disconnetti)
- [ ] Sidebar `220px`, nav items con indicatore barra sinistra su attivo
- [ ] Label sezione sidebar uppercase muted
- [ ] Badge numerici nav (condivisi, cestino)
- [ ] Storage bar animata con gradient
- [ ] Bottone "Acquista altro spazio" outline → fill on hover
- [ ] Page title + sottotitolo con saluto personalizzato
- [ ] 5 folder cards in grid 5 colonne
- [ ] Ogni card: icona SVG colorata, nome, meta, hover actions (condividi + opzioni)
- [ ] Tabella file: th uppercase muted, td con icone colorate per tipo
- [ ] Azioni riga visibili solo su hover
- [ ] Badge condivisione (Privata / Condiviso / Team)
- [ ] Paginazione in footer tabella
- [ ] Modale upload con drag&drop e badge E2E
- [ ] Toast sistema per feedback

---

## 17. NOTE IMPORTANTI PER CURSOR

1. **Mantieni tutti i `data-testid`, `id` e `aria-*`** già presenti — servono ai test
2. **Non rimuovere classi funzionali** come `hidden`, `sr-only`, `pointer-events-none` se già presenti
3. **I componenti Tauri** (tutto ciò che usa `invoke`, `listen`, `appWindow`) non vanno toccati nella logica, solo nel wrapper visivo
4. **AuthContext.tsx** — puoi solo modificare le classi CSS del JSX restituito, nulla altro
5. **useCrypto.ts** — non toccare, è puro JS logico senza UI
6. **Il file `globals.css`** può essere modificato per aggiungere le CSS variables e il font import
7. **Tailwind**: aggiungere i token `ax-*` in `tailwind.config.ts` come mostrato sopra
8. **Immagine logo**: il file logo è in `public/` o `assets/` — usare sempre quello, non inline base64 nel codice sorgente
9. **Responsive**: priorità desktop (min 1280px), poi adattare per 1024px
10. **Animazioni**: usare `transition-all duration-200` come standard, `duration-150` per micro-interazioni

---

## 18. STRUTTURA FILE DA MODIFICARE

```
frontend/
├── app/
│   ├── layout.tsx                  ← Font import + CSS variables
│   ├── globals.css                 ← CSS variables, body styles
│   ├── (auth)/
│   │   └── login/
│   │       └── page.tsx            ← Pagina login/register — UI COMPLETA DA RIFARE
│   └── (app)/
│       └── dashboard/
│           └── page.tsx            ← Dashboard — UI COMPLETA DA RIFARE
├── components/
│   ├── ui/                         ← Componenti base (Button, Input, ecc.)
│   ├── layout/
│   │   ├── Header.tsx              ← Header dashboard
│   │   └── Sidebar.tsx             ← Sidebar dashboard
│   └── files/
│       ├── FileTable.tsx           ← Tabella file
│       └── FolderCard.tsx          ← Card cartelle
└── tailwind.config.ts              ← Aggiungere token ax-*
```

---

*Fine specifica — versione 1.0*  
*Riferimenti visivi: `/ui-specs/axshare-login.html` · `/ui-specs/axshare-dashboard.html` · `/ui-specs/axshare-palette.html`*

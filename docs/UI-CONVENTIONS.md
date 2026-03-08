# AXSHARE — Convenzioni UI

Documento di riferimento per mantenere coerenza tra tutte le pagine.  
Queste impostazioni sono state definite sulla dashboard e vanno applicate ovunque ci siano tabelle file/cartelle o card tipo "In Evidenza".

---

## Tabella file e cartelle

| Elemento | Regola |
|----------|--------|
| Icona **file** | 52×52 px; `.file-type-icon-wrap` + `.file-type-icon` con override per `.file-table-row-file` |
| Icona **cartella** | 44×44 px; `getFolderColorIcon(folder.color ?? 'yellow', true)` |
| Cella NOME (solo file) | `td:nth-child(2)` padding-left 9px |
| Wrap icona (solo file) | padding-left 9px, 52×52 px |
| Nome file / input (solo file) | `.file-name`, `.file-name-inline-edit`: padding-left 2px |
| Classi righe | Cartelle: `file-table-row-folder`; File: `file-table-row-file` |

---

## Card tipo "In Evidenza"

| Elemento | Regola |
|----------|--------|
| Icona **cartella** | 68×58 px; wrap `.folder-icon-img-wrap-card-folder`; margin-bottom 4px |
| Icona **file** | 56×48 px; wrap `.folder-icon-img-wrap` |
| Titolo (`.folder-name`) | padding-left 4px (solo in `.folder-card-favorite`) |
| Sottotitolo (`.folder-meta`) | padding-left 4px (solo in `.folder-card-favorite`) |

---

## Icone cartelle (globale)

- Usare **`getFolderColorIcon(color, isEncrypted)`** con `color` da API e `isEncrypted: true`.
- Riservare `getFolderIconByIndex` solo per le opzioni colore nei menu (es. `opt.index`).

---

Le regole dettagliate per Cursor sono in `.cursor/rules/axshare-ui-conventions.mdc`.

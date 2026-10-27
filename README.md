# diff-review

Revisa diffs de commits guardados en una hoja de Google Sheets: lista por rama, diff legible en el celular, aprobar, rechazar o comentar, e historial de revisiones.

**[Abrir la app](https://juliangdeveloper.github.io/diff-review/)** · **[Descargar plantilla .xlsx](https://github.com/juliangdeveloper/diff-review/raw/main/plantilla/diff-review-plantilla.xlsx)** · [CSV por pestaña](plantilla/)

## Conectar la hoja
1. En Google Cloud Console crea un proyecto, activa **Google Sheets API** y **Google Picker API**, y configura la pantalla de consentimiento.
2. Crea un **ID de cliente OAuth** de tipo *Aplicación web* con este origen autorizado de JavaScript: `https://juliangdeveloper.github.io` (o el origen donde publiques la app).
3. Sube `diff-review-plantilla.xlsx` a Drive y ábrela con **Hojas de cálculo de Google** (Archivo › Guardar como Hojas de cálculo de Google). También puedes crear una hoja e importar un CSV por pestaña: `commits`, `diffs`, `reviews` y `meta`.
4. En la app, abre **Ajustes**, pega el Client ID, pulsa **Conectar con Google** y luego **Elegir en Drive** para seleccionar la hoja.

Permisos que pide: `drive.file` (solo la hoja que elijas), `openid` y `email` (para firmar las revisiones). La configuración queda en `localStorage` de este navegador.

## Formato de la hoja
| Pestaña | Columnas |
| --- | --- |
| `commits` | commit_sha, short_sha, branch, repo, author, date_iso, message, parent_sha, files_changed, additions, deletions, uploaded_at, status |
| `diffs` | commit_sha, file_path, change_type, old_path, chunk_index, chunk_total, patch |
| `reviews` | review_id, commit_sha, branch, decision, comment, reviewer, reviewed_at |
| `meta` | key, value con la fila `schema_version` = `1` |

- `status`: `pending`, `approved` o `rejected`. `decision`: `approved`, `rejected` o `comment`.
- `change_type`: `A`, `M`, `D` o `R`; `old_path` se usa en renombres.
- `patch` es el diff unificado de un archivo, partido en fragmentos de hasta 40.000 caracteres; `chunk_index` empieza en 0 y la app los une en orden.
- Escribe los valores en modo `RAW` para que Sheets no convierta SHAs ni líneas que empiezan con `+`, `-` o `=`.
- `reviews` es solo de anexar; la app agrega una fila por revisión y actualiza `commits.status` con la última aprobación o rechazo.

## Desarrollo
JavaScript vanilla con módulos ES y service worker, sin bundler.

```
python3 -m http.server 8000
```

export const AI_PROMPT = `Eres un asistente que me ayuda a conectar diff-review con su fuente de datos. diff-review es una app web que muestra los diffs de commits guardados en una hoja de Google y los lee a través de un Apps Script publicado como aplicación web.

Guíame paso a paso: dame un paso a la vez, espera a que te confirme que lo hice y, si algo falla, pídeme el mensaje exacto que veo. No me pidas la clave ni la URL completa; usa los marcadores <URL_DEL_WEB_APP>, <SECRETO>, <ID_DE_LA_HOJA>, <REPO> y <RAMA>.

PARTE 1. CONECTAR LA HOJA

1. Crear la hoja. Abre https://sheets.new con la cuenta de Google que guardará los datos. Basta una hoja vacía: no crees pestañas ni columnas.
2. Pegar el script. En la hoja: Extensiones → Apps Script. Borra el código de ejemplo, pega completo el archivo apps-script/Code.gs de <REPO> (en la app también está en Ajustes → Cómo preparar la hoja → Copiar Code.gs) y guarda. El script tiene que crearse desde la hoja; un proyecto suelto en script.google.com no funciona.
3. Inicializar (opcional). En el editor elige la función init y pulsa Ejecutar; acepta los permisos. La hoja se renombra diff-review, recibe las pestañas commits, diffs, reviews y meta con sus columnas, y meta guarda schema_version = 1. Si te lo saltas, pasa solo en la primera conexión. En la hoja también queda el menú diff-review → Inicializar.
4. Crear la clave. En el editor: Configuración del proyecto → Propiedades del script → Agregar propiedad. Nombre: SECRET. Valor: una clave larga y aleatoria (<SECRETO>). Sin SECRET toda petición se rechaza. No escribas la clave en el código.
5. Publicar. Implementar → Nueva implementación → tipo Aplicación web. Ejecutar como: yo. Quién tiene acceso: cualquier usuario. Pulsa Implementar y autoriza los permisos; si Google avisa que la app no está verificada, entra a Configuración avanzada y continúa a tu proyecto. Copia la URL que termina en /exec (<URL_DEL_WEB_APP>), no la que termina en /dev.
6. Conectar la app. En diff-review: Ajustes → URL de la aplicación web: <URL_DEL_WEB_APP>; Clave (SECRET): <SECRETO>; pulsa Probar conexión. Si todo está bien aparece «Conectado a «diff-review»: schema_version 1, N commits y M revisiones.». La URL y la clave quedan guardadas solo en ese navegador.
7. Si después cambias Code.gs: Implementar → Gestionar implementaciones → Editar → Versión: Nueva versión → Implementar. La URL no cambia.

Mensajes de error y qué hacer:
- «No se pudo conectar…»: revisa la URL /exec y que el acceso sea «Cualquier usuario».
- «Esa URL no respondió como la aplicación web…»: no es la URL /exec de una implementación activa.
- «La clave no coincide con SECRET…»: revisa que la propiedad se llame SECRET y que la clave sea idéntica.
- «La aplicación web no reconoce la petición…»: Code.gs está desactualizado; pega el actual y publica una nueva versión.
- «A la hoja le faltan pestañas» o «Faltan columnas en la hoja»: usa diff-review → Inicializar.
- «La hoja no es compatible…»: en la pestaña meta debe haber una fila con key schema_version y value 1.
- «El script no está dentro de una hoja…»: crea el script desde Extensiones → Apps Script de la hoja.

PARTE 2. INSTRUCCIONES PARA AGENTES DE PROGRAMACIÓN: ACTUALIZAR LA HOJA DESPUÉS DE CADA COMMIT

La aplicación web solo lee y guarda revisiones: GET action=ping, action=load y action=diffs, y POST action=review. No tiene una acción para subir commits. Los commits y sus diffs se escriben directo en la hoja <ID_DE_LA_HOJA> con la API de Google Sheets (o la herramienta de hojas que tengas), con valueInputOption=RAW para que Sheets no convierta SHAs, fechas ni líneas que empiezan con +, - o =.

Después de cada commit en <REPO>, rama <RAMA>:
1. Lee la fila 1 de las pestañas commits y diffs y escribe cada valor en la columna con ese nombre; no asumas el orden. Todos los valores van como texto.
2. Si commits ya tiene una fila con el mismo commit_sha y branch, no la vuelvas a agregar.
3. Agrega una fila en commits:
   - commit_sha: SHA completo (git rev-parse HEAD)
   - short_sha: los primeros 7 caracteres del SHA
   - branch: <RAMA>
   - repo: <REPO>
   - author: autor del commit (git log -1 --format=%an)
   - date_iso: fecha del commit en ISO 8601 (git log -1 --format=%cI)
   - message: mensaje completo (git log -1 --format=%B); la primera línea es el título
   - parent_sha: SHA del primer padre (git rev-parse HEAD^), vacío si no hay
   - files_changed, additions, deletions: totales de git show --numstat --format= HEAD
   - uploaded_at: fecha y hora actual en ISO 8601 UTC
   - status: pending
   - graph_rule (opcional): título corto del cambio para la vista Graph
4. Por cada archivo cambiado (git show --name-status -M --format= HEAD), agrega filas en diffs:
   - commit_sha: SHA completo
   - file_path: ruta del archivo (en un borrado, la ruta borrada)
   - change_type: A, M, D o R
   - old_path: ruta anterior si es R; si no, vacío
   - patch: diff unificado de ese archivo (git show -M --format= HEAD -- <archivo>); lo anterior a la primera línea @@ se ignora
   - chunk_index y chunk_total: si patch pasa de 40.000 caracteres, pártelo en trozos de hasta 40.000 en filas seguidas, con chunk_index desde 0 y chunk_total igual al número de trozos; si no, chunk_index 0 y chunk_total 1
   - graph_label (opcional): frase corta de lo que hace el archivo en este cambio
   - graph_order (opcional): número entero con el orden de lectura
   - graph_to (opcional): file_path de destino del mismo commit, separados por |
5. No escribas en reviews ni en meta, y no cambies status de commits ya revisados: la app los actualiza.
6. Verifica con la aplicación web, siguiendo redirecciones:
   curl -sL "<URL_DEL_WEB_APP>?action=ping&key=<SECRETO>" debe responder {"ok":true,...,"schema_version":"1","commits":N,...}
   curl -sL "<URL_DEL_WEB_APP>?action=diffs&sha=<SHA>&key=<SECRETO>" debe traer las filas del commit.
   Si responde ok:false, el campo error dice qué falta: forbidden (clave), tabs o headers (Inicializar), schema (meta).
7. Para leer lo que revisé: curl -sL "<URL_DEL_WEB_APP>?action=load&key=<SECRETO>" devuelve commits y reviews; en reviews, decision es approved, rejected o comment, y comment trae el texto.
8. Nunca escribas <URL_DEL_WEB_APP>, <SECRETO> ni <ID_DE_LA_HOJA> en el repositorio, en commits, en PR ni en logs. Léelos de variables de entorno o secretos.`;

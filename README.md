# 🔍 diff-review

**Mobile code review for AI agent commits: review git diffs and change graphs on your phone, without pull requests, on your own Google Sheet.**

> Revisa desde el celular los commits que tu agente de IA escribe en tu propia hoja de Google: lee el diff y aprueba, rechaza o comenta.

**[▶ Ver demo](https://juliangdeveloper.github.io/diff-review/?demo=1)** · datos de ejemplo, sin conectar nada

<img src="assets/screenshot.png" alt="Diff de un commit en diff-review con los botones para aprobar, rechazar o comentar" width="320">

```mermaid
flowchart LR
  A[Agente de IA o script] -->|commit y diffs, API de Sheets| S[(Tu hoja de Google)]
  S <-->|Apps Script| P[PWA diff-review]
  P -->|aprobar, rechazar, comentar| S
  S -->|action load| A
```

## Cómo se usa
- En **Commits** ves la lista con su estado y la filtras por rama o estado; **Ramas** agrupa los commits por rama.
- Abre un commit para leer el diff de cada archivo, con números de línea y ajuste de líneas largas.
- **Graph**, en ese detalle, dibuja un bloque por archivo si la hoja trae la regla y las conexiones. Tocar un bloque abre el diff de ese archivo. Sin datos de grafo, **Graph** muestra «Este commit no tiene datos de grafo».
- **Estructura**, junto a **Graph**, muestra las funciones que cambiaron en cada archivo, marcadas como añadida, quitada o modificada, con sus condiciones, bucles, `return` y llamadas cambiadas. Tocar una función o una de sus líneas abre el diff de ese archivo en esa línea. Analiza JavaScript, TypeScript y Python.
- **Aprobar**, **Rechazar** o **Comentar**, con un comentario opcional. Cada revisión queda en la pestaña `reviews` y aprobar o rechazar cambia el `status` del commit en la hoja; no toca git ni tu repositorio. Tu agente lee las revisiones con `load`. Comentar no cambia el estado.
- En **Historial** revisas todas las revisiones, de la más reciente a la más antigua.
- En **Ajustes** puedes poner un nombre de revisor para firmar tus revisiones.

## Conectar tu hoja
La app lee y escribe en una hoja de Google a través de un Apps Script que publicas tú. La URL y la clave se guardan solo en tu navegador, nunca en el repositorio. Dentro de la app, **Cómo preparar la hoja** trae estos pasos y el script listo para copiar.

**Prompt IA**, junto a ese botón, copia un prompt para pegar en tu asistente de IA: te guía paso a paso en la conexión y le explica a un agente de programación cómo cargar cada commit y sus diffs en la hoja, sin escribir la URL ni la clave en el repositorio.

1. Crea una hoja vacía en [sheets.new](https://sheets.new).
2. En la hoja: **Extensiones → Apps Script**, borra el ejemplo y pega el contenido de [`apps-script/Code.gs`](apps-script/Code.gs).
3. En **Configuración del proyecto → Propiedades del script**, crea `SECRET` con una clave larga.
4. **Implementar → Nueva implementación → Aplicación web**, con **Ejecutar como: yo** y **Acceso: cualquier usuario**; acepta los permisos.
5. Copia la URL que termina en `/exec`, pégala en **Ajustes** junto con la clave y pulsa **Probar conexión**.

La hoja se renombra `diff-review` y recibe sus pestañas (`commits`, `diffs`, `structure`, `reviews`, `meta`) y columnas en la primera conexión. El menú **diff-review → Inicializar** de la hoja hace lo mismo a mano. Una hoja nueva también recibe las columnas opcionales del grafo: `graph_rule` en commits y `graph_label`, `graph_order`, `graph_to` en diffs. Una hoja que ya tiene sus columnas no se modifica; sin esas cabeceras, **Graph** no dibuja el diagrama.

La pestaña `structure` guarda los datos de **Estructura**: `commit_sha`, `file_path`, `node_id`, `parent_id`, `kind`, `name`, `status`, `line` y `detail`. `meta` guarda `schema_version` 2. Con el `Code.gs` actual, una hoja con `schema_version` 1 recibe la pestaña `structure` y sube a 2 en la siguiente petición, sin tocar los datos. Con un `Code.gs` anterior la app sigue funcionando y **Estructura** pide actualizarlo.

Si cambias `Code.gs`: **Implementar → Gestionar implementaciones → Editar → Nueva versión** (la URL no cambia).

Para usar **Estructura** en una hoja que ya tenías, pega el `Code.gs` actual y publica una nueva versión; no hace falta volver a inicializar.

### Cómo llegan los commits
La app y el Apps Script no suben commits: solo leen y guardan revisiones. Los commits y sus diffs se escriben directo en la hoja, con la API de Google Sheets o a mano, en modo `RAW`, que guarda tal cual los SHAs y las líneas que empiezan con `+`, `-` o `=`. La parte 2 de **Prompt IA** le dice a un agente de programación qué columnas llenar después de cada commit y cómo verificarlo con las acciones `ping` y `diffs`, y cómo leer tus revisiones con `load`.

Los datos de **Estructura** los genera el agente en su máquina después de cada commit con [`tools/structure.mjs`](tools/structure.mjs), que usa [`tools/structure.py`](tools/structure.py) para Python. Compara cada archivo antes y después del commit y devuelve filas listas para `structure`:

```
npm install --prefix /tmp/diff-review-tools typescript@5
NODE_PATH=/tmp/diff-review-tools/node_modules node tools/structure.mjs HEAD
```

Necesita Node 18 o superior, git y, para Python, `python3`. La app no analiza código: la hoja solo guarda fragmentos de cada diff y un analizador completo pesaría demasiado en el celular.

### Seguridad
- El Apps Script se publica con acceso para **cualquier usuario**. Cada petición es un `POST` con la clave en el cuerpo JSON, que se compara con `SECRET` en las propiedades del script; sin ella, o sin `SECRET`, responde `forbidden`.
- Mantén en privado la URL `/exec` y la clave: la app las guarda en el `localStorage` del navegador.
- Con las dos, alguien podría leer todos los commits, diffs y revisiones de la hoja, y agregar revisiones o cambiar el estado de un commit. No puede subir commits ni tocar tu repositorio.
- Si se filtran, cambia `SECRET` en las propiedades del script y actualiza la clave en **Ajustes**.

## Stack
JavaScript vanilla (módulos ES), service worker para uso offline y Google Apps Script como backend. Sin bundler.

```
python3 -m http.server 8000   # abrir http://localhost:8000/?demo=1
```

Versión actual: `diff-review v0.3.0`.

Licencia: [MIT](LICENSE).

**Estructura** se inspira en [diffgraph](https://github.com/miltonlaufer/diffgraph) de Milton Läufer (licencia MIT). El código de diff-review es propio y no copia código de diffgraph.

---

Más proyectos: https://juliangdeveloper.github.io/

Hecho con ❤️ y 🔍

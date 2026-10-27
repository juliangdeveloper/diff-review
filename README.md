# 🔍 diff-review

> Revisa diffs de commits desde el celular, conectado a tu propia hoja de Google.

**[▶ Ver demo](https://juliangdeveloper.github.io/diff-review/?demo=1)** · datos de ejemplo, sin conectar nada

<img src="assets/screenshot.png" alt="Diff de un commit en diff-review con los botones para aprobar, rechazar o comentar" width="320">

## Cómo se usa
- En **Commits** ves la lista con su estado y la filtras por rama o estado; **Ramas** agrupa los commits por rama.
- Abre un commit para leer el diff de cada archivo, con números de línea y ajuste de líneas largas.
- **Aprobar**, **Rechazar** o **Comentar**, con un comentario opcional; el comentario no cambia el estado.
- En **Historial** revisas todas las revisiones, de la más reciente a la más antigua.
- En **Ajustes** puedes poner un nombre de revisor para firmar tus revisiones.

## Conectar tu hoja
La app lee y escribe en una hoja de Google a través de un Apps Script que publicas tú. La URL y la clave se guardan solo en tu navegador, nunca en el repositorio. Dentro de la app, **Cómo preparar la hoja** trae estos pasos y el script listo para copiar.

1. Abre [script.new](https://script.new) para crear un proyecto de Apps Script.
2. Borra el ejemplo y pega el contenido de [`apps-script/Code.gs`](apps-script/Code.gs).
3. Elige la función `setup`, pulsa **Ejecutar** y acepta los permisos. La hoja `diff-review` aparece en la raíz de **Mi unidad**; puedes moverla a otra carpeta.
4. En **Configuración del proyecto → Propiedades del script**, crea `SECRET` con una clave larga.
5. **Implementar → Nueva implementación → Aplicación web**, con **Ejecutar como: yo** y **Acceso: cualquier usuario**.
6. Copia la URL que termina en `/exec`, pégala en **Ajustes** junto con la clave y pulsa **Probar conexión**.

Si cambias `Code.gs`: **Implementar → Gestionar implementaciones → Editar → Nueva versión** (la URL no cambia).

Si cargas datos en la hoja por tu cuenta, escribe los valores en modo `RAW` para que Sheets no convierta SHAs ni líneas que empiezan con `+`, `-` o `=`.

## Stack
JavaScript vanilla (módulos ES), service worker para uso offline y Google Apps Script como backend. Sin bundler.

```
python3 -m http.server 8000   # abrir http://localhost:8000/?demo=1
```

Versión actual: `diff-review v0.2.1`.

---

Más proyectos: https://juliangdeveloper.github.io/

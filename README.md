# ❄️ SnowDigest

Extensión de Chrome (Manifest V3) que resume y convierte en material de estudio el contenido de los cursos de **ServiceNow University**, usando la API de Anthropic (Claude).

## Funciones

- **4 modos de salida:** Resumen, Puntos clave, Flashcards (pregunta/respuesta) y Notas para Obsidian (Markdown con tags y wikilinks)
- **Menú contextual:** selecciona texto en el curso → clic derecho → *SnowDigest: Resumir selección*
- **Modelo seleccionable** desde la página de opciones
- **Modo alternativo sin API:** copia un prompt ya formateado al portapapeles para pegarlo en claude.ai
- Muestra el consumo de tokens de cada solicitud

## Retos técnicos

- El contenido de los cursos vive dentro de un **iframe de otro dominio** (reproductor Rustici). Se extrae con `chrome.scripting.executeScript` usando `allFrames: true`.
- Llamadas directas a la API de Anthropic desde el service worker, manejando CORS con el header `anthropic-dangerous-direct-browser-access`.
- La API key se guarda localmente en `chrome.storage.local`; nunca se incluye en el código.

## Tecnologías

JavaScript · Chrome Extensions API (Manifest V3) · Anthropic Messages API

## Instalación

1. Clona o descarga este repositorio.
2. Abre `chrome://extensions` y activa el **Modo de desarrollador**.
3. Clic en **"Cargar descomprimida"** y selecciona la carpeta del proyecto.
4. Abre las **Opciones** de la extensión, pega tu API key de Anthropic ([console.anthropic.com](https://console.anthropic.com)) y prueba la conexión.

## Uso

1. Entra a un curso en [learning.servicenow.com](https://learning.servicenow.com).
2. Abre el popup de SnowDigest, elige el modo y genera el resultado.

// SnowDigest — Background Service Worker

const PROMPTS = {
  resumen: {
    label: "Resumen",
    system: "Eres un asistente experto en ServiceNow. Tu trabajo es resumir contenido de cursos de ServiceNow University de forma clara y concisa en español. Genera un resumen que capture los puntos esenciales sin perder información crítica. Usa un tono profesional pero accesible.",
    user: (text) => `Resume el siguiente contenido de un curso de ServiceNow University. El resumen debe ser conciso pero completo, capturando los conceptos clave, definiciones importantes, y cualquier procedimiento o paso mencionado.\n\nContenido:\n${text}`
  },
  puntos: {
    label: "Puntos clave",
    system: "Eres un asistente experto en ServiceNow. Extrae los puntos clave del contenido de cursos de ServiceNow University. Presenta la información como una lista clara y organizada en español.",
    user: (text) => `Extrae los puntos clave del siguiente contenido de un curso de ServiceNow University. Organízalos en una lista clara con viñetas. Incluye definiciones, conceptos importantes, y pasos de procedimientos si los hay.\n\nContenido:\n${text}`
  },
  flashcards: {
    label: "Flashcards",
    system: "Eres un asistente experto en ServiceNow. Crea flashcards de estudio (pregunta y respuesta) a partir del contenido de cursos de ServiceNow University. Las flashcards deben ser en español y cubrir los conceptos más importantes.",
    user: (text) => `Crea flashcards de estudio (formato Pregunta / Respuesta) a partir del siguiente contenido de un curso de ServiceNow University. Genera entre 5 y 10 flashcards que cubran los conceptos más importantes. Usa el formato:\n\nQ: [pregunta]\nA: [respuesta]\n\nContenido:\n${text}`
  },
  obsidian: {
    label: "Notas Obsidian",
    system: "Eres un asistente experto en ServiceNow. Transforma contenido de cursos en notas estructuradas para Obsidian con formato Markdown, usando wikilinks, tags, y estructura jerárquica clara. Las notas deben ser en español.",
    user: (text) => `Transforma el siguiente contenido de un curso de ServiceNow University en una nota estructurada para Obsidian. Incluye:\n- Título con formato de heading\n- Tags relevantes (ej: #servicenow #atf)\n- Resumen breve al inicio\n- Secciones organizadas con headings\n- Conceptos clave resaltados\n- Wikilinks para términos que podrían tener su propia nota (ej: [[Flow Designer]], [[ATF]])\n\nContenido:\n${text}`
  }
};

// Context menu setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "snowdigest-selection",
    title: "SnowDigest: Resumir selección",
    contexts: ["selection"],
    documentUrlPatterns: ["https://nowlearning.servicenow.com/*", "https://learning.servicenow.com/*"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "snowdigest-selection" && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      action: "showOverlay",
      text: info.selectionText,
      source: "selection"
    });
  }
});

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "summarize") {
    handleSummarize(request).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // async
  }

  if (request.action === "getConfig") {
    chrome.storage.local.get(["apiKey", "model", "preferredMode"], (data) => {
      sendResponse({
        apiKey: data.apiKey || "",
        model: data.model || "claude-haiku-4-5-20251001",
        preferredMode: data.preferredMode || "resumen"
      });
    });
    return true;
  }

  if (request.action === "buildPrompt") {
    const promptConfig = PROMPTS[request.mode] || PROMPTS.resumen;
    const fullPrompt = `${promptConfig.system}\n\n---\n\n${promptConfig.user(request.text)}`;
    sendResponse({ prompt: fullPrompt });
    return true;
  }

  if (request.action === "getPromptConfig") {
    sendResponse({ prompts: Object.keys(PROMPTS).map(k => ({ id: k, label: PROMPTS[k].label })) });
    return true;
  }
});

async function handleSummarize({ text, mode }) {
  const data = await chrome.storage.local.get(["apiKey", "model"]);
  const apiKey = data.apiKey;
  const model = data.model || "claude-haiku-4-5-20251001";

  if (!apiKey) {
    return { error: "NO_API_KEY", message: "No hay API key configurada" };
  }

  const promptConfig = PROMPTS[mode] || PROMPTS.resumen;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 2048,
        system: promptConfig.system,
        messages: [
          { role: "user", content: promptConfig.user(text) }
        ]
      })
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      if (response.status === 401) {
        return { error: "INVALID_KEY", message: "API key inválida" };
      }
      if (response.status === 429) {
        return { error: "RATE_LIMIT", message: "Demasiadas solicitudes, espera un momento" };
      }
      if (errBody?.error?.message?.includes("credit")) {
        return { error: "NO_CREDITS", message: "Sin créditos disponibles" };
      }
      return { error: "API_ERROR", message: errBody?.error?.message || `Error ${response.status}` };
    }

    const result = await response.json();
    const outputText = result.content
      .filter(c => c.type === "text")
      .map(c => c.text)
      .join("\n");

    // Calculate approximate cost
    const inputTokens = result.usage?.input_tokens || 0;
    const outputTokens = result.usage?.output_tokens || 0;
    let costPerMTokIn = 1, costPerMTokOut = 5; // Haiku defaults
    if (model.includes("sonnet")) { costPerMTokIn = 3; costPerMTokOut = 15; }
    const cost = (inputTokens * costPerMTokIn + outputTokens * costPerMTokOut) / 1_000_000;

    return {
      success: true,
      text: outputText,
      usage: { inputTokens, outputTokens, cost: cost.toFixed(6) }
    };
  } catch (err) {
    return { error: "NETWORK", message: "Error de conexión: " + err.message };
  }
}

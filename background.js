// SnowDigest — Background Service Worker

// Techo de salida por modo: flashcards y notas Obsidian son las mas largas.
const MAX_TOKENS = {
  resumen: 2048,
  puntos: 2048,
  flashcards: 4096,
  obsidian: 4096
};

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
  console.log("[SnowDigest] Message received:", request.action);

  if (request.action === "summarize") {
    console.log("[SnowDigest] Starting summarize, text length:", request.text?.length, "mode:", request.mode);
    handleSummarize(request).then(result => {
      console.log("[SnowDigest] Summarize result:", result.success ? "OK" : result.error);
      sendResponse(result);
    }).catch(err => {
      console.error("[SnowDigest] Summarize exception:", err);
      sendResponse({ error: "EXCEPTION", message: err.message });
    });
    return true;
  }

  if (request.action === "getConfig") {
    chrome.storage.local.get(["apiKey", "model", "preferredMode"], (data) => {
      console.log("[SnowDigest] Config loaded - hasKey:", !!data.apiKey, "keyPrefix:", data.apiKey?.substring(0, 10), "model:", data.model);
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

  if (request.action === "testApiKey") {
    console.log("[SnowDigest] Testing API key...");
    testApiKey(request.apiKey, request.model).then(result => {
      console.log("[SnowDigest] Test result:", result);
      sendResponse(result);
    }).catch(err => {
      console.error("[SnowDigest] Test exception:", err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

async function testApiKey(apiKey, model) {
  console.log("[SnowDigest] testApiKey called, keyPrefix:", apiKey?.substring(0, 10), "model:", model);
  
  if (!apiKey) {
    return { success: false, error: "No API key provided" };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: model || "claude-haiku-4-5-20251001",
        max_tokens: 32,
        messages: [
          { role: "user", content: "Di solo: OK" }
        ]
      })
    });

    console.log("[SnowDigest] Test API response status:", response.status);
    const data = await response.json();
    console.log("[SnowDigest] Test API response body:", JSON.stringify(data).substring(0, 200));

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${data?.error?.message || "Unknown error"}`, status: response.status };
    }

    const text = data.content?.filter(c => c.type === "text")?.map(c => c.text)?.join("") || "";
    return { success: true, response: text, usage: data.usage };
  } catch (err) {
    console.error("[SnowDigest] Test fetch error:", err);
    return { success: false, error: "Network error: " + err.message };
  }
}

async function handleSummarize({ text, mode }) {
  const data = await chrome.storage.local.get(["apiKey", "model"]);
  const apiKey = data.apiKey;
  const model = data.model || "claude-haiku-4-5-20251001";

  console.log("[SnowDigest] handleSummarize - hasKey:", !!apiKey, "model:", model, "textLen:", text?.length);

  if (!apiKey) {
    return { error: "NO_API_KEY", message: "No hay API key configurada" };
  }

  const promptConfig = PROMPTS[mode] || PROMPTS.resumen;

  try {
    console.log("[SnowDigest] Calling API...");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: MAX_TOKENS[mode] || 2048,
        system: promptConfig.system,
        messages: [
          { role: "user", content: promptConfig.user(text) }
        ]
      })
    });

    console.log("[SnowDigest] API response status:", response.status);

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error("[SnowDigest] API error body:", JSON.stringify(errBody));
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
    console.log("[SnowDigest] API success, usage:", result.usage);
    
    const outputText = result.content
      .filter(c => c.type === "text")
      .map(c => c.text)
      .join("\n");

    const inputTokens = result.usage?.input_tokens || 0;
    const outputTokens = result.usage?.output_tokens || 0;
    const PRICES = {
      "claude-haiku-4-5-20251001":  { in: 1, out: 5 },
      "claude-sonnet-5":            { in: 2, out: 10 },
      "claude-sonnet-4-6-20250514": { in: 3, out: 15 },
      "claude-opus-5":              { in: 5, out: 25 }
    };
    const price = PRICES[model] || PRICES["claude-haiku-4-5-20251001"];
    const cost = (inputTokens * price.in + outputTokens * price.out) / 1_000_000;

    return {
      success: true,
      text: outputText,
      usage: { inputTokens, outputTokens, cost: cost.toFixed(6) }
    };
  } catch (err) {
    console.error("[SnowDigest] Fetch error:", err);
    return { error: "NETWORK", message: "Error de conexión: " + err.message };
  }
}

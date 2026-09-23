// SnowDigest — Popup Logic

let currentMode = "resumen";
let extractedContent = "";
let extractedMeta = {};
let hasApiKey = false;
let currentModel = "claude-haiku-4-5-20251001";

const CLAUDE_AI_URL = "https://claude.ai/new";

// Mode labels for button text
const MODE_LABELS = {
  resumen: "Resumir",
  puntos: "Extraer puntos clave de",
  flashcards: "Crear flashcards de",
  obsidian: "Generar nota Obsidian de"
};

// Init
document.addEventListener("DOMContentLoaded", async () => {
  // Check if we're on a NowLearning page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isOnSite = tab?.url?.includes("nowlearning.servicenow.com") || tab?.url?.includes("learning.servicenow.com");

  // Options link — se registra antes del early return para que
  // "Configuracion" tambien funcione fuera de nowlearning.
  document.getElementById("linkOptions").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  if (!isOnSite) {
    document.getElementById("mainContent").style.display = "none";
    document.getElementById("notOnSite").style.display = "block";
    return;
  }

  // Load config
  const config = await sendMessage({ action: "getConfig" });
  hasApiKey = !!config.apiKey;
  currentModel = config.model || "claude-haiku-4-5-20251001";
  currentMode = config.preferredMode || "resumen";

  updateModeUI();
  updateStatusUI();

  // Extract content from page — lesson content is inside a cross-origin Rustici iframe
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        const frViews = document.querySelectorAll(".fr-view");
        const blockTexts = document.querySelectorAll(".block-text .block-text__container");
        const lessonSection = document.querySelector("section.blocks-lesson");
        
        let content = "";
        
        if (frViews.length > 0) {
          const parts = [];
          frViews.forEach(fv => {
            const t = fv.textContent.trim();
            if (t.length > 5) parts.push(t);
          });
          content = parts.join("\n\n");
        }
        
        if (!content && blockTexts.length > 0) {
          const parts = [];
          blockTexts.forEach(bt => {
            const t = bt.textContent.trim();
            if (t.length > 5) parts.push(t);
          });
          content = parts.join("\n\n");
        }
        
        if (!content && lessonSection) {
          const clone = lessonSection.cloneNode(true);
          clone.querySelectorAll("script, style, nav, button, input, svg, img, video, [hidden]").forEach(el => el.remove());
          content = clone.textContent.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        }
        
        const h1 = document.querySelector("h1");
        const title = h1 ? h1.textContent.trim() : "";
        const lessonMatch = document.body.textContent.match(/lesson\s+(\d+)\s+of\s+(\d+)/i);
        const lessonNumber = lessonMatch ? `${lessonMatch[1]} de ${lessonMatch[2]}` : "";
        
        if (!content || content.length < 20) return null;
        
        return { 
          meta: { lesson: title, lessonNumber, course: "", url: location.href }, 
          content
        };
      }
    });
    
    const validResult = results?.find(r => r.result && r.result.content);
    if (validResult) {
      extractedContent = validResult.result.content;
      extractedMeta = validResult.result.meta;
      extractedMeta.url = tab.url;
      updateMetaUI();
    } else {
      document.getElementById("lessonTitle").textContent = "No se encontró contenido en esta página";
      document.getElementById("btnProcess").disabled = true;
    }
  } catch (e) {
    console.error("[SnowDigest] Extraction error:", e);
    document.getElementById("lessonTitle").textContent = "Error al extraer: " + e.message;
    document.getElementById("btnProcess").disabled = true;
  }

  // Mode buttons
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      currentMode = btn.dataset.mode;
      updateModeUI();
      // Save preference
      chrome.storage.local.set({ preferredMode: currentMode });
    });
  });

  // Process full section
  document.getElementById("btnProcess").addEventListener("click", () => {
    if (!extractedContent) {
      showError("No se encontró contenido en la página. Intenta seleccionar texto.");
      return;
    }
    processText(extractedContent);
  });

  // Process selection
  document.getElementById("btnSelection").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      // Check all frames for selected text (content is in Rustici iframe)
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          const sel = window.getSelection()?.toString()?.trim();
          // Also check cached selection if available
          const cached = window.__snowdigest_cached_selection || "";
          return sel || cached || "";
        }
      });
      const selText = results?.map(r => r.result).filter(t => t && t.length > 10)?.[0];
      if (selText) {
        processText(selText);
      } else {
        showError("Selecciona texto en la página primero.");
      }
    } catch (e) {
      showError("No se pudo acceder a la página. Recarga e intenta de nuevo.");
    }
  });

  // Open in Claude.ai (fallback)
  document.getElementById("btnClaudeAI").addEventListener("click", async () => {
    const text = extractedContent || "";
    if (!text) { showError("No hay contenido para enviar."); return; }
    const prompt = await buildPromptText(text, currentMode);
    // Copy to clipboard and open Claude.ai
    await navigator.clipboard.writeText(prompt);
    chrome.tabs.create({ url: CLAUDE_AI_URL });
  });

  // Copy prompt (fallback)
  document.getElementById("btnCopyPrompt").addEventListener("click", async () => {
    const text = extractedContent || "";
    if (!text) { showError("No hay contenido para copiar."); return; }
    const prompt = await buildPromptText(text, currentMode);
    await navigator.clipboard.writeText(prompt);
    const btn = document.getElementById("btnCopyPrompt");
    btn.textContent = "✓ Copiado al clipboard";
    setTimeout(() => btn.textContent = "Copiar prompt al clipboard", 1500);
  });

  // Result actions
  document.getElementById("btnCopyResult").addEventListener("click", async () => {
    const text = document.getElementById("resultText").textContent;
    await navigator.clipboard.writeText(text);
    document.getElementById("btnCopyResult").textContent = "✓";
    setTimeout(() => document.getElementById("btnCopyResult").textContent = "📋 Copiar", 1200);
  });

  document.getElementById("btnCopyMd").addEventListener("click", async () => {
    const text = document.getElementById("resultText").textContent;
    const md = formatAsMarkdown(text);
    await navigator.clipboard.writeText(md);
    document.getElementById("btnCopyMd").textContent = "✓";
    setTimeout(() => document.getElementById("btnCopyMd").textContent = "📝 Markdown", 1200);
  });

  document.getElementById("btnNewDigest").addEventListener("click", () => {
    document.getElementById("resultArea").style.display = "none";
    document.getElementById("usageInfo").style.display = "none";
    document.getElementById("actionGroup").style.display = "flex";
  });

});

function updateModeUI() {
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === currentMode);
  });
  const label = MODE_LABELS[currentMode] || "Resumir";
  document.getElementById("btnProcess").textContent = `${label} sección`;
  document.getElementById("btnSelection").textContent = `${label} texto seleccionado`;
}

function updateStatusUI() {
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  const btnClaude = document.getElementById("btnClaudeAI");
  const btnCopy = document.getElementById("btnCopyPrompt");

  if (hasApiKey) {
    dot.className = "status-dot api";
    const modelLabel = currentModel.includes("sonnet") ? "Sonnet" : "Haiku";
    text.textContent = `Modo API (${modelLabel})`;
    btnClaude.style.display = "none";
    btnCopy.style.display = "none";
  } else {
    dot.className = "status-dot extractor";
    text.textContent = "Modo extractor (sin API key)";
    btnClaude.style.display = "block";
    btnCopy.style.display = "block";
  }
}

function updateMetaUI() {
  if (extractedMeta.lessonNumber) {
    document.getElementById("lessonNum").textContent = `Lección ${extractedMeta.lessonNumber}`;
  }
  if (extractedMeta.lesson) {
    document.getElementById("lessonTitle").textContent = extractedMeta.lesson;
  }
  if (extractedMeta.course) {
    document.getElementById("courseBadge").textContent = extractedMeta.course;
    document.getElementById("courseBadge").title = extractedMeta.course;
  }

  // Show content length
  if (extractedContent) {
    const words = extractedContent.split(/\s+/).length;
    document.getElementById("lessonNum").textContent += ` · ~${words} palabras`;
  }
}

async function processText(text) {
  hideError();

  if (hasApiKey) {
    // API mode
    document.getElementById("actionGroup").style.display = "none";
    document.getElementById("loading").style.display = "block";

    const modelLabel = currentModel.includes("sonnet") ? "Sonnet" : "Haiku";
    document.querySelector(".loading-text").textContent = `Generando con ${modelLabel}...`;

    const response = await sendMessage({
      action: "summarize",
      text: text,
      mode: currentMode
    });

    document.getElementById("loading").style.display = "none";

    if (response.error) {
      document.getElementById("actionGroup").style.display = "flex";
      if (response.error === "NO_CREDITS") {
        showError("Sin créditos. Usa el modo extractor o agrega fondos en console.anthropic.com");
        // Switch to extractor mode visually
        hasApiKey = false;
        updateStatusUI();
      } else {
        showError(response.message || "Error al procesar");
      }
      return;
    }

    // Show result
    document.getElementById("resultText").textContent = response.text;
    document.getElementById("resultArea").style.display = "block";

    if (response.usage) {
      const info = `${response.usage.inputTokens} in / ${response.usage.outputTokens} out · ~$${response.usage.cost}`;
      document.getElementById("usageInfo").textContent = info;
      document.getElementById("usageInfo").style.display = "block";
    }
  } else {
    // Extractor mode — copy prompt
    const prompt = await buildPromptText(text, currentMode);
    await navigator.clipboard.writeText(prompt);
    showError("Prompt copiado al clipboard. Pégalo en claude.ai ↗");
  }
}

async function buildPromptText(text, mode) {
  const response = await sendMessage({ action: "buildPrompt", text, mode });
  return response.prompt || text;
}

function formatAsMarkdown(text) {
  const meta = extractedMeta;
  let md = "";
  if (meta.course) md += `# ${meta.course}\n`;
  if (meta.lesson) md += `## ${meta.lesson}\n`;
  if (meta.lessonNumber) md += `> Lección ${meta.lessonNumber}\n`;
  md += `\n---\n\n${text}\n`;
  if (meta.url) md += `\n---\n*Fuente: ${meta.url}*\n`;
  return md;
}

function showError(msg) {
  document.getElementById("errorText").textContent = msg;
  document.getElementById("errorMsg").style.display = "block";
}

function hideError() {
  document.getElementById("errorMsg").style.display = "none";
}

function sendMessage(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, resolve);
  });
}

// SnowDigest — Content Script
// Extracts lesson content from ServiceNow University pages

(function () {
  "use strict";

  // Extraction strategies for NowLearning page structure
  function extractLessonContent() {
    const meta = extractLessonMeta();
    let content = "";

    // Strategy 1: Main content area (most common layout)
    const selectors = [
      ".lesson-content",
      ".content-area",
      "[class*='lesson'] [class*='content']",
      "[class*='course-content']",
      ".activity-content",
      "article",
      "[role='main']",
      ".main-content"
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 100) {
        content = cleanText(el);
        break;
      }
    }

    // Strategy 2: iframes (NowLearning sometimes loads content in iframes)
    if (!content) {
      const iframes = document.querySelectorAll("iframe");
      for (const iframe of iframes) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc && doc.body && doc.body.textContent.trim().length > 100) {
            content = cleanText(doc.body);
            break;
          }
        } catch (e) {
          // Cross-origin iframe, skip
        }
      }
    }

    // Strategy 3: Largest text block on page (fallback)
    if (!content) {
      const blocks = document.querySelectorAll("div, section, main");
      let best = { el: null, len: 0 };
      blocks.forEach(el => {
        const text = el.textContent.trim();
        // Skip nav, sidebar, footer elements
        const tag = el.closest("nav, header, footer, [class*='sidebar'], [class*='nav'], [class*='menu']");
        if (!tag && text.length > best.len && text.length > 200) {
          best = { el, len: text.length };
        }
      });
      if (best.el) {
        content = cleanText(best.el);
      }
    }

    return { meta, content };
  }

  function extractLessonMeta() {
    const meta = {
      course: "",
      lesson: "",
      lessonNumber: "",
      url: window.location.href
    };

    // Try breadcrumb
    const breadcrumbs = document.querySelectorAll(".breadcrumb a, [class*='breadcrumb'] a, nav a");
    if (breadcrumbs.length >= 2) {
      meta.course = breadcrumbs[breadcrumbs.length - 2]?.textContent?.trim() || "";
    }

    // Try lesson title
    const h1 = document.querySelector("h1");
    if (h1) meta.lesson = h1.textContent.trim();

    // Try lesson number (e.g. "Lesson 2 of 12")
    const lessonNum = document.body.textContent.match(/lesson\s+(\d+)\s+of\s+(\d+)/i);
    if (lessonNum) {
      meta.lessonNumber = `${lessonNum[1]} de ${lessonNum[2]}`;
    }

    return meta;
  }

  function cleanText(element) {
    // Clone to avoid modifying the page
    const clone = element.cloneNode(true);

    // Remove scripts, styles, navs, hidden elements
    clone.querySelectorAll("script, style, nav, footer, header, [hidden], [aria-hidden='true'], button, input, select, .sidebar, [class*='nav'], [class*='menu']")
      .forEach(el => el.remove());

    // Get text, normalize whitespace
    let text = clone.textContent || "";
    text = text.replace(/[ \t]+/g, " ");
    text = text.replace(/\n{3,}/g, "\n\n");
    text = text.trim();

    return text;
  }

  // Listen for messages from popup or background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractContent") {
      const result = extractLessonContent();
      sendResponse(result);
      return true;
    }

    if (request.action === "extractSelection") {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : "";
      const meta = extractLessonMeta();
      sendResponse({ meta, content: text });
      return true;
    }

    if (request.action === "showOverlay") {
      showResultOverlay(request.text, request.source);
      return true;
    }

    if (request.action === "showResult") {
      showResultOverlay(request.text, "api");
      return true;
    }
  });

  // Floating result overlay on the page
  function showResultOverlay(text, source) {
    // Remove existing
    const existing = document.getElementById("snowdigest-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "snowdigest-overlay";
    overlay.innerHTML = `
      <div class="sd-overlay-header">
        <span class="sd-overlay-logo">❄ SnowDigest</span>
        <button class="sd-overlay-close" title="Cerrar">&times;</button>
      </div>
      <div class="sd-overlay-body">${escapeHtml(text)}</div>
      <div class="sd-overlay-actions">
        <button class="sd-btn sd-btn-copy" title="Copiar">📋 Copiar</button>
        <button class="sd-btn sd-btn-md" title="Copiar como Markdown">📝 Copiar .md</button>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector(".sd-overlay-close").addEventListener("click", () => overlay.remove());
    overlay.querySelector(".sd-btn-copy").addEventListener("click", () => {
      navigator.clipboard.writeText(text);
      overlay.querySelector(".sd-btn-copy").textContent = "✓ Copiado";
      setTimeout(() => overlay.querySelector(".sd-btn-copy").textContent = "📋 Copiar", 1500);
    });
    overlay.querySelector(".sd-btn-md").addEventListener("click", () => {
      navigator.clipboard.writeText(text);
      overlay.querySelector(".sd-btn-md").textContent = "✓ Copiado";
      setTimeout(() => overlay.querySelector(".sd-btn-md").textContent = "📝 Copiar .md", 1500);
    });
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  }
})();

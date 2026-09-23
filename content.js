// SnowDigest — Content Script
// Extracts lesson content from ServiceNow University pages

(function () {
  "use strict";

  // Cache the last text selection (because opening the popup clears it)
  let cachedSelection = "";

  document.addEventListener("mouseup", () => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (text.length > 10) {
      cachedSelection = text;
      window.__snowdigest_cached_selection = text;
    }
  });

  // Also cache on keyup (for keyboard selection)
  document.addEventListener("keyup", () => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (text.length > 10) {
      cachedSelection = text;
      window.__snowdigest_cached_selection = text;
    }
  });

  function extractLessonContent() {
    const meta = extractLessonMeta();
    let content = "";

    // Strategy 1: NowLearning specific — Froala editor views inside lesson blocks
    // Structure: section.blocks-lesson > div[data-ba="lessonEdit.block"] > .block-text > .fr-view > p
    const frViews = document.querySelectorAll("section.blocks-lesson .fr-view");
    if (frViews.length > 0) {
      const parts = [];
      frViews.forEach(fv => {
        const text = fv.textContent.trim();
        if (text.length > 5) parts.push(text);
      });
      if (parts.length > 0) {
        content = parts.join("\n\n");
      }
    }

    // Strategy 2: Try broader NowLearning selectors
    if (!content || content.length < 50) {
      const lessonSection = document.querySelector("section.blocks-lesson");
      if (lessonSection) {
        content = cleanElement(lessonSection);
      }
    }

    // Strategy 3: Try block-text containers
    if (!content || content.length < 50) {
      const blockTexts = document.querySelectorAll(".block-text .block-text__container");
      if (blockTexts.length > 0) {
        const parts = [];
        blockTexts.forEach(bt => {
          const text = bt.textContent.trim();
          if (text.length > 5) parts.push(text);
        });
        if (parts.length > 0) content = parts.join("\n\n");
      }
    }

    // Strategy 4: Generic selectors for non-lesson pages (course overview, etc.)
    if (!content || content.length < 50) {
      const candidateSelectors = [
        ".content-panel",
        ".lesson-content",
        ".course-content-area",
        "main",
        "[role='main']",
        "article"
      ];

      for (const sel of candidateSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const cleaned = cleanElement(el);
          if (cleaned.length > 100) {
            content = cleaned;
            break;
          }
        }
      }
    }

    // Strategy 5: Find the largest content block that ISN'T the sidebar
    if (!content || content.length < 100) {
      content = extractByLargestBlock();
    }

    // Strategy 3: Try iframes (NowLearning sometimes uses them)
    if (!content || content.length < 100) {
      const iframes = document.querySelectorAll("iframe");
      for (const iframe of iframes) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc && doc.body) {
            const cleaned = cleanElement(doc.body);
            if (cleaned.length > 100) {
              content = cleaned;
              break;
            }
          }
        } catch (e) { /* cross-origin */ }
      }
    }

    return { meta, content };
  }

  function extractByLargestBlock() {
    // Get all potential content containers
    const candidates = document.querySelectorAll("div, section, main, article");
    let best = { text: "", score: 0 };

    for (const el of candidates) {
      // Skip elements that are clearly NOT lesson content
      if (isNavOrChrome(el)) continue;

      // Skip elements that are too small or too large (whole page)
      const rect = el.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 100) continue;
      if (el === document.body || el === document.documentElement) continue;

      // Calculate a content score:
      // - Prefer elements with lots of <p>, <li>, <h2>, <h3> children (prose)
      // - Penalize elements with lots of <nav>, <button>, <a> (chrome)
      const proseElements = el.querySelectorAll("p, li, h2, h3, h4, blockquote, figcaption");
      const chromeElements = el.querySelectorAll("nav, button, input, select, [class*='nav'], [class*='menu'], [class*='sidebar']");
      
      const proseCount = proseElements.length;
      const chromeCount = chromeElements.length;
      
      if (proseCount < 2) continue; // Need at least some prose
      
      const score = proseCount * 10 - chromeCount * 20;
      
      if (score > best.score) {
        const cleaned = cleanElement(el);
        if (cleaned.length > 100 && cleaned.length < 50000) {
          best = { text: cleaned, score };
        }
      }
    }

    return best.text;
  }

  function isNavOrChrome(el) {
    // Check if element or its parents are navigation/chrome
    const tag = el.tagName.toLowerCase();
    if (["nav", "header", "footer"].includes(tag)) return true;

    const cls = (el.className || "").toString().toLowerCase();
    const id = (el.id || "").toLowerCase();
    const combined = cls + " " + id;

    const chromePatterns = [
      "sidebar", "side-bar", "nav", "menu", "toolbar",
      "breadcrumb", "footer", "header", "banner",
      "cookie", "modal", "popup", "tooltip",
      "course-nav", "lesson-nav", "toc", "table-of-contents",
      "progress", "completion"
    ];

    return chromePatterns.some(p => combined.includes(p));
  }

  function cleanElement(element) {
    const clone = element.cloneNode(true);

    // Remove all non-content elements
    const removeSelectors = [
      "script", "style", "noscript", "svg", "img", "video", "audio", "canvas",
      "iframe", "object", "embed",
      "nav", "footer", "header",
      "button", "input", "select", "textarea", "form",
      "[hidden]", "[aria-hidden='true']",
      "[class*='sidebar']", "[class*='side-bar']",
      "[class*='nav']", "[class*='menu']",
      "[class*='breadcrumb']",
      "[class*='toolbar']", "[class*='tool-bar']",
      "[class*='footer']", "[class*='header']",
      "[class*='modal']", "[class*='popup']",
      "[class*='cookie']", "[class*='banner']",
      "[class*='progress']", "[class*='completion']",
      "[class*='course-card']",
      "[class*='toc']",
      "[role='navigation']", "[role='banner']", "[role='contentinfo']"
    ];

    removeSelectors.forEach(sel => {
      try {
        clone.querySelectorAll(sel).forEach(el => el.remove());
      } catch(e) { /* invalid selector */ }
    });

    // Get text and normalize
    let text = "";
    
    // Walk through remaining nodes to preserve structure better
    const walker = document.createTreeWalker(
      clone,
      NodeFilter.SHOW_TEXT,
      null
    );

    let node;
    while (node = walker.nextNode()) {
      const t = node.textContent.trim();
      if (t) {
        text += t + " ";
      }
    }

    // Normalize whitespace
    text = text.replace(/[ \t]+/g, " ");
    text = text.replace(/\n{3,}/g, "\n\n");
    text = text.trim();

    // Final cleanup: remove very short lines that are likely UI artifacts
    const lines = text.split(/\n/);
    const filtered = lines.filter(line => {
      const trimmed = line.trim();
      // Keep lines with actual content
      if (trimmed.length > 20) return true;
      // Keep shorter lines that are part of lists or have substance
      if (trimmed.length > 5 && !trimmed.match(/^(EXIT|COURSE|HOME|MENU|SEARCH|LOGIN|SIGN|NEXT|PREV|BACK|\d+%)/i)) return true;
      return false;
    });

    return filtered.join("\n").trim();
  }

  function extractLessonMeta() {
    const meta = {
      course: "",
      lesson: "",
      lessonNumber: "",
      url: window.location.href
    };

    // Try to find lesson title - usually the first h1 in the content area
    const h1s = document.querySelectorAll("h1");
    for (const h1 of h1s) {
      if (!isNavOrChrome(h1.parentElement) && h1.textContent.trim().length > 3) {
        meta.lesson = h1.textContent.trim();
        break;
      }
    }

    // Try breadcrumb for course name
    const breadcrumbs = document.querySelectorAll("a[href*='course'], a[href*='learning'], .breadcrumb a");
    if (breadcrumbs.length >= 1) {
      for (const bc of breadcrumbs) {
        const text = bc.textContent.trim();
        if (text.length > 5 && text !== meta.lesson) {
          meta.course = text;
          break;
        }
      }
    }

    // Try lesson number
    const pageText = document.body.textContent;
    const lessonMatch = pageText.match(/lesson\s+(\d+)\s+of\s+(\d+)/i);
    if (lessonMatch) {
      meta.lessonNumber = `${lessonMatch[1]} de ${lessonMatch[2]}`;
    }

    return meta;
  }

  // Listen for messages
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractContent") {
      const result = extractLessonContent();
      console.log("[SnowDigest] Extracted content length:", result.content.length, "meta:", result.meta);
      sendResponse(result);
      return true;
    }

    if (request.action === "extractSelection") {
      // Use cached selection since popup opening clears the real one
      const text = cachedSelection || window.getSelection()?.toString()?.trim() || "";
      const meta = extractLessonMeta();
      console.log("[SnowDigest] Selection length:", text.length, "(cached)");
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

  // Floating result overlay
  function showResultOverlay(text, source) {
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

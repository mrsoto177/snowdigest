// SnowDigest — Options page logic

document.addEventListener("DOMContentLoaded", () => {
  // Load saved config
  const MIGRACION = { "claude-sonnet-4-6-20250514": "claude-sonnet-5" };

  chrome.storage.local.get(["apiKey", "model", "preferredMode"], (data) => {
    if (MIGRACION[data.model]) {
      data.model = MIGRACION[data.model];
      chrome.storage.local.set({ model: data.model });
    }
    if (data.apiKey) document.getElementById("apiKey").value = data.apiKey;
    if (data.model) document.getElementById("model").value = data.model;
    if (data.preferredMode) document.getElementById("defaultMode").value = data.preferredMode;
  });

  // Save
  document.getElementById("btnSave").addEventListener("click", () => {
    const apiKey = document.getElementById("apiKey").value.trim();
    const model = document.getElementById("model").value;
    const preferredMode = document.getElementById("defaultMode").value;
    const btn = document.getElementById("btnSave");

    chrome.storage.local.set({ apiKey, model, preferredMode }, () => {
      btn.textContent = "✓ Configuración guardada";
      btn.style.background = "#22c55e";
      const toast = document.getElementById("toast");
      toast.style.display = "block";
      setTimeout(() => {
        btn.textContent = "Guardar configuración";
        btn.style.background = "#3b82f6";
        toast.style.display = "none";
      }, 3000);
    });
  });

  // Test API connection
  document.getElementById("btnTest").addEventListener("click", () => {
    const apiKey = document.getElementById("apiKey").value.trim();
    const model = document.getElementById("model").value;
    const resultDiv = document.getElementById("testResult");
    const btn = document.getElementById("btnTest");

    if (!apiKey) {
      resultDiv.style.display = "block";
      resultDiv.style.background = "rgba(239,68,68,0.1)";
      resultDiv.style.border = "1px solid rgba(239,68,68,0.3)";
      resultDiv.style.color = "#f87171";
      resultDiv.textContent = "Ingresa una API key primero.";
      return;
    }

    btn.textContent = "Probando...";
    btn.disabled = true;
    resultDiv.style.display = "none";

    chrome.runtime.sendMessage(
      { action: "testApiKey", apiKey: apiKey, model: model },
      (response) => {
        btn.textContent = "Probar conexión API";
        btn.disabled = false;
        resultDiv.style.display = "block";

        if (chrome.runtime.lastError) {
          resultDiv.style.background = "rgba(239,68,68,0.1)";
          resultDiv.style.border = "1px solid rgba(239,68,68,0.3)";
          resultDiv.style.color = "#f87171";
          resultDiv.textContent = "Error: " + chrome.runtime.lastError.message;
          return;
        }

        if (response && response.success) {
          resultDiv.style.background = "rgba(74,222,128,0.1)";
          resultDiv.style.border = "1px solid rgba(74,222,128,0.3)";
          resultDiv.style.color = "#4ade80";
          resultDiv.textContent = "✓ Conexión exitosa. Respuesta: \"" + response.response + "\" (" + response.usage?.input_tokens + " in / " + response.usage?.output_tokens + " out)";
        } else {
          resultDiv.style.background = "rgba(239,68,68,0.1)";
          resultDiv.style.border = "1px solid rgba(239,68,68,0.3)";
          resultDiv.style.color = "#f87171";
          resultDiv.textContent = "✗ Error: " + (response?.error || "Sin respuesta del service worker");
        }
      }
    );
  });
});

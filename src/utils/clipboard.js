/**
 * copyText — copy a string to the clipboard with a fallback for non-secure
 * contexts. Over plain HTTP on a LAN IP, navigator.clipboard is undefined
 * (the Clipboard API requires a secure context: HTTPS or localhost), so we
 * fall back to a hidden textarea + execCommand("copy"). Returns a Promise
 * that resolves on success and rejects on failure.
 */
export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("execCommand copy failed"));
    } catch (err) {
      reject(err);
    }
  });
}

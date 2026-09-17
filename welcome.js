// window.close() only works on tabs a script itself opened. This page is
// opened by the extension via chrome.tabs.create, so window.close() alone
// silently does nothing here. chrome.tabs.remove() is the reliable way to
// close the extension's own tab.
//
// THE REAL BUG (found via brave://extensions -> Fine Print Sentinel ->
// Errors): this code lived inline in welcome.html as a <script> block.
// Manifest V3 extension pages default to a Content Security Policy of
// script-src 'self', which blocks inline scripts outright, no exception,
// no silent partial execution. The two earlier "fixes" (switching from
// chrome.tabs.getCurrent to chrome.tabs.query, adding lastError checks)
// were real improvements but couldn't have mattered: none of that code
// ever ran even once. Moving it to this external file is what actually
// lets Chrome execute it, since 'self' explicitly allows scripts loaded
// from files packaged with the extension.
const gotItBtn = document.getElementById("gotit");

function tellUserToCloseManually() {
  gotItBtn.disabled = false;
  gotItBtn.textContent = "You can close this tab now";
}

gotItBtn.addEventListener("click", () => {
  gotItBtn.disabled = true;
  gotItBtn.textContent = "Closing…";

  try {
    if (!chrome?.tabs?.query) {
      if (window.close) window.close();
      setTimeout(tellUserToCloseManually, 300);
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs || !tabs[0] || tabs[0].id === undefined) {
        if (window.close) window.close();
        setTimeout(tellUserToCloseManually, 300);
        return;
      }
      chrome.tabs.remove(tabs[0].id, () => {
        if (chrome.runtime.lastError) {
          tellUserToCloseManually();
        }
      });
    });
  } catch (err) {
    if (window.close) window.close();
    setTimeout(tellUserToCloseManually, 300);
  }
});

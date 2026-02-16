const ROW_SELECTOR = "table.torrent-list > tbody > tr";
const INJECTED_ATTR = "data-sukebei-cover-enhanced";
const LIGHTBOX_ID = "sch-cover-lightbox";
const HOVERBOX_ID = "sch-cover-hoverbox";
const HOVER_DELAY_MS = 220;
const HIDE_DELAY_MS = 160;

let hoverTimer = null;
let hideTimer = null;
let activeCode = "";
let activeTitle = "";
const inFlight = new Map();

init();

function init() {
  injectRowHoverHandlers();

  const observer = new MutationObserver(() => injectRowHoverHandlers());
  observer.observe(document.body, { childList: true, subtree: true });
}

function injectRowHoverHandlers() {
  const rows = document.querySelectorAll(ROW_SELECTOR);

  for (const row of rows) {
    if (row.getAttribute(INJECTED_ATTR) === "1") {
      continue;
    }

    const nameCell = row.querySelector("td:nth-child(2)");
    if (!nameCell) {
      continue;
    }

    const titleLink = nameCell.querySelector("a") || nameCell;
    const titleText = (titleLink?.textContent || nameCell.textContent || "").trim();
    const code = extractCode(titleText);

    if (!code) {
      row.setAttribute(INJECTED_ATTR, "1");
      continue;
    }

    titleLink.addEventListener("mouseenter", (event) => {
      clearTimeout(hideTimer);
      hoverTimer = setTimeout(() => {
        showHoverPreview(code, titleText, event);
      }, HOVER_DELAY_MS);
    });

    titleLink.addEventListener("mousemove", (event) => {
      positionHoverbox(event.clientX, event.clientY);
    });

    titleLink.addEventListener("mouseleave", () => {
      clearTimeout(hoverTimer);
      hideTimer = setTimeout(() => hideHoverbox(), HIDE_DELAY_MS);
    });

    row.setAttribute(INJECTED_ATTR, "1");
  }
}

async function showHoverPreview(code, title, event) {
  const hoverbox = ensureHoverbox();
  setHoverboxLoading();
  positionHoverbox(event.clientX, event.clientY);
  hoverbox.classList.add("is-open");

  activeCode = code;
  activeTitle = title;

  try {
    const data = await fetchCover(code, title);
    if (activeCode !== code || activeTitle !== title) {
      return;
    }
    renderHoverbox(data);
  } catch (err) {
    if (activeCode !== code || activeTitle !== title) {
      return;
    }
    setHoverboxError(err?.message || String(err));
  }
}

function hideHoverbox() {
  const hoverbox = document.getElementById(HOVERBOX_ID);
  if (!hoverbox) return;
  hoverbox.classList.remove("is-open");
}

function ensureHoverbox() {
  let box = document.getElementById(HOVERBOX_ID);
  if (box) return box;

  box = document.createElement("div");
  box.id = HOVERBOX_ID;
  box.className = "sch-cover-hoverbox";
  box.innerHTML = [
    '<div class="sch-cover-hoverbox-status">Loading...</div>',
    '<img class="sch-cover-hoverbox-img" alt="cover preview" />',
    '<div class="sch-cover-hoverbox-meta">',
    '  <div class="sch-cover-hoverbox-title"></div>',
    '  <div class="sch-cover-hoverbox-code"></div>',
    '  <a class="sch-cover-hoverbox-link" target="_blank" rel="noopener noreferrer"></a>',
    '</div>'
  ].join("");

  box.addEventListener("mouseenter", () => {
    clearTimeout(hideTimer);
  });

  box.addEventListener("mouseleave", () => {
    hideTimer = setTimeout(() => hideHoverbox(), HIDE_DELAY_MS);
  });

  box.addEventListener("click", (event) => {
    const img = event.target.closest(".sch-cover-hoverbox-img");
    if (!img || !img.src) return;
    openLightbox(img.src, img.alt || "cover");
  });

  document.body.appendChild(box);
  return box;
}

function setHoverboxLoading() {
  const box = ensureHoverbox();
  box.classList.add("is-loading");
  box.classList.remove("is-error");
  const status = box.querySelector(".sch-cover-hoverbox-status");
  if (status) status.textContent = "Loading cover...";
}

function setHoverboxError(message) {
  const box = ensureHoverbox();
  box.classList.remove("is-loading");
  box.classList.add("is-error");
  const status = box.querySelector(".sch-cover-hoverbox-status");
  if (status) status.textContent = "Cover lookup failed: " + message;
}

function renderHoverbox(data) {
  const box = ensureHoverbox();
  box.classList.remove("is-loading", "is-error");

  const status = box.querySelector(".sch-cover-hoverbox-status");
  const img = box.querySelector(".sch-cover-hoverbox-img");
  const title = box.querySelector(".sch-cover-hoverbox-title");
  const code = box.querySelector(".sch-cover-hoverbox-code");
  const link = box.querySelector(".sch-cover-hoverbox-link");

  if (status) status.textContent = "";
  if (img) {
    img.src = data.coverUrl;
    img.alt = data.title || data.code;
  }
  if (title) title.textContent = data.title || data.code;
  if (code) code.textContent = data.code;

  if (link) {
    if (data.itemUrl) {
      link.href = data.itemUrl;
      link.textContent = data.linkLabel || "Open Source";
      link.style.display = "inline";
    } else {
      link.removeAttribute("href");
      link.textContent = "";
      link.style.display = "none";
    }
  }
}

function positionHoverbox(clientX, clientY) {
  const box = ensureHoverbox();
  const margin = 14;
  const x = Math.min(clientX + 18, window.innerWidth - 420 - margin);
  const y = Math.min(clientY + 16, window.innerHeight - 560 - margin);
  box.style.left = Math.max(margin, x) + "px";
  box.style.top = Math.max(margin, y) + "px";
}

function fetchCover(code, title) {
  if (inFlight.has(code)) {
    return inFlight.get(code);
  }

  const req = chrome.runtime
    .sendMessage({ type: "FETCH_COVER", code, title })
    .then((response) => {
      if (!response?.ok || !response?.data) {
        throw new Error(response?.error || "Unknown error");
      }
      return response.data;
    })
    .finally(() => {
      inFlight.delete(code);
    });

  inFlight.set(code, req);
  return req;
}

function extractCode(text) {
  const m = String(text || "").toUpperCase().match(/\b([A-Z]{2,7})[-_ ]?(\d{2,5})\b/);
  if (!m) return "";
  return `${m[1]}-${m[2]}`;
}

function openLightbox(src, alt) {
  const overlay = ensureLightbox();
  const img = overlay.querySelector("img");
  if (!img) return;

  img.src = src;
  img.alt = alt || "cover";
  overlay.classList.add("is-open");
}

function closeLightbox() {
  const overlay = document.getElementById(LIGHTBOX_ID);
  if (!overlay) return;
  overlay.classList.remove("is-open");
}

function ensureLightbox() {
  let overlay = document.getElementById(LIGHTBOX_ID);
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = LIGHTBOX_ID;
  overlay.className = "sch-cover-lightbox";
  overlay.innerHTML = '<img class="sch-cover-lightbox-img" alt="cover preview" />';

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeLightbox();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeLightbox();
      hideHoverbox();
    }
  });

  document.body.appendChild(overlay);
  return overlay;
}

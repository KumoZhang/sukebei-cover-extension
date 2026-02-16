const SETTINGS_KEY = "dmmSettings";
const apiIdInput = document.getElementById("apiId");
const affiliateIdInput = document.getElementById("affiliateId");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");

init();

async function init() {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  const settings = data[SETTINGS_KEY] || {};

  apiIdInput.value = settings.apiId || "";
  affiliateIdInput.value = settings.affiliateId || "";
}

saveBtn.addEventListener("click", async () => {
  const apiId = apiIdInput.value.trim();
  const affiliateId = affiliateIdInput.value.trim();

  if (!apiId || !affiliateId) {
    setStatus("Please fill API ID and Affiliate ID.", true);
    return;
  }

  await chrome.storage.sync.set({
    [SETTINGS_KEY]: { apiId, affiliateId }
  });

  setStatus("Settings saved.", false);
});

function setStatus(message, isError) {
  status.textContent = message;
  status.style.color = isError ? "#bf2b2b" : "#2b7a3f";
}

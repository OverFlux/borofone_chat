const desktop = window.borotalkDesktop;
const inviteButton = document.querySelector("#inviteButton");
const manualForm = document.querySelector("#manualForm");
const hostUrl = document.querySelector("#hostUrl");
const statusElement = document.querySelector("#status");
const savedHost = document.querySelector("#savedHost");
const savedHostUrl = document.querySelector("#savedHostUrl");
const savedHostButton = document.querySelector("#savedHostButton");

function setBusy(busy, message = "") {
  inviteButton.disabled = busy;
  savedHostButton.disabled = busy;
  hostUrl.disabled = busy;
  manualForm.querySelector("button").disabled = busy;
  if (message) showStatus(message);
}

function showStatus(message, isError = false) {
  statusElement.textContent = message || "";
  statusElement.hidden = !message;
  statusElement.classList.toggle("is-error", isError);
}

async function runConnection(action, progressText) {
  setBusy(true, progressText);
  try {
    const result = await action();
    if (result === null) {
      setBusy(false);
      showStatus("");
    }
  } catch (error) {
    showStatus(error?.message || "Не удалось подключиться к хосту.", true);
    setBusy(false);
  }
}

inviteButton.addEventListener("click", () => {
  void runConnection(() => desktop.chooseInvite(), "Открываем файл подключения…");
});

savedHostButton.addEventListener("click", () => {
  void runConnection(() => desktop.connectSaved(), "Проверяем сохранённый хост…");
});

manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void runConnection(
    () => desktop.connectManual(hostUrl.value),
    "Проверяем адрес и сертификат хоста…",
  );
});

for (const eventName of ["dragenter", "dragover"]) {
  document.addEventListener(eventName, (event) => {
    event.preventDefault();
    inviteButton.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  document.addEventListener(eventName, (event) => {
    event.preventDefault();
    inviteButton.classList.remove("is-dragging");
  });
}

document.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file || !file.name.toLowerCase().endsWith(".borotalk")) {
    showStatus("Нужен файл с расширением .borotalk.", true);
    return;
  }
  if (file.size > 64 * 1024) {
    showStatus("Файл подключения слишком большой.", true);
    return;
  }
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    void runConnection(
      () => desktop.importInviteText(String(reader.result || "")),
      "Проверяем инвайт и сертификат…",
    );
  });
  reader.addEventListener("error", () => showStatus("Не удалось прочитать файл.", true));
  reader.readAsText(file);
});

desktop.onConnectionError((message) => {
  if (!message) return;
  showStatus(message, true);
  setBusy(false);
});

void desktop.getConnection().then((connection) => {
  if (!connection) return;
  savedHost.hidden = false;
  savedHostUrl.textContent = connection.baseUrl;
  hostUrl.value = connection.baseUrl;
});

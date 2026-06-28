const remoteForm = document.querySelector("#remoteForm");
const serverUrl = document.querySelector("#serverUrl");
const localButton = document.querySelector("#localButton");
const errorText = document.querySelector("#errorText");

remoteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorText.textContent = "";
  const response = await window.kolink.connectRemote(serverUrl.value);
  if (!response.ok) errorText.textContent = response.error;
});

localButton.addEventListener("click", async () => {
  errorText.textContent = "";
  await window.kolink.connectLocal();
});

// ====== ССЫЛКИ НА ЭЛЕМЕНТЫ И UI-ХЕЛПЕРЫ ======
const $ = (sel) => document.querySelector(sel);

// Эти id должны существовать в твоём HTML:
const connectBtn    = $("#connectBtn");
const disconnectBtn = $("#disconnectBtn");
const claimBtn      = $("#claimBtn");
const copyBtn       = $("#copyBtn");
const addrBox       = $("#addrBox");
const networkBox    = $("#networkBox");
const notice        = $("#notice");

// Функции защиты от отсутствующих элементов (если каких-то нет — просто молча пропускаем)
function setText(el, text) { if (el) el.textContent = text; }
function setHTML(el, html) { if (el) el.innerHTML = html; }
function show(el) { if (el) el.classList.remove("hidden"); }
function hide(el) { if (el) el.classList.add("hidden"); }

// Короткая форма адреса
function short(addr){ return addr ? addr.slice(0,6) + "…" + addr.slice(-4) : "—"; }

// ====== НАСТРОЙКА WEB3MODAL ДЛЯ POLYGON ======
let web3Modal;
let web3ProviderRaw;          // провайдер из Web3Modal (raw)
let provider;                 // ethers.providers.Web3Provider
let signer;                   // ethers.Signer
let currentAddress = null;

function initWeb3Modal(){
  const WalletConnectPkg = (window.WalletConnectProvider && (window.WalletConnectProvider.default || window.WalletConnectProvider));
  if (!WalletConnectPkg) {
    console.error("WalletConnectProvider не найден. Проверь подключение UMD-скрипта.");
  }

  const providerOptions = {
    walletconnect: {
      package: WalletConnectPkg,
      options: {
        rpc: {
          137: "https://polygon-rpc.com/"
        },
        chainId: 137
      }
    }
    // Ledger Desktop напрямую в браузере — боль.
    // Ledger/Trust/многие другие работают через WalletConnect (QR/Deep link).
  };

  web3Modal = new window.Web3Modal.default({
    cacheProvider: false,
    providerOptions
  });
}

// ====== ЛОГИКА ПОДКЛЮЧЕНИЯ ======
async function connect(){
  try {
    // Открыть модал выбора кошелька
    web3ProviderRaw = await web3Modal.connect();

    // Оборачиваем в ethers-провайдер; 'any' чтобы ловить смену сети
    provider = new ethers.providers.Web3Provider(web3ProviderRaw, 'any');
    signer   = provider.getSigner();

    // Получаем адрес и сеть
    currentAddress = await signer.getAddress();
    const net = await provider.getNetwork();

    setText(addrBox,    `Адрес: ${short(currentAddress)}`);
    setText(networkBox, `Сеть: ${net.name ? net.name : "Polygon"} (${net.chainId})`);

    // UI
    hide(connectBtn);
    show(disconnectBtn);
    if (claimBtn) claimBtn.disabled = false;
    if (copyBtn)  copyBtn.disabled  = false;

    // Слушатели изменений от кошелька
    if (web3ProviderRaw && web3ProviderRaw.on){
      web3ProviderRaw.on("accountsChanged", onAccountsChanged);
      web3ProviderRaw.on("chainChanged",    onChainChanged);
      web3ProviderRaw.on("disconnect",      onDisconnected);
    }

    // Если не Polygon — вежливо предложим переключиться
    if (net.chainId !== 137) {
      try {
        await web3ProviderRaw.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x89" }] // 137 в hex
        });
        // обновим отображение
        const net2 = await provider.getNetwork();
        setText(networkBox, `Сеть: ${net2.name ? net2.name : "Polygon"} (${net2.chainId})`);
      } catch (e) {
        // если кошелёк не знает про Polygon — попытаемся добавить
        try {
          await web3ProviderRaw.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0x89",
              chainName: "Polygon Mainnet",
              nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
              rpcUrls: ["https://polygon-rpc.com/"],
              blockExplorerUrls: ["https://polygonscan.com"]
            }]
          });
          const net3 = await provider.getNetwork();
          setText(networkBox, `Сеть: ${net3.name ? net3.name : "Polygon"} (${net3.chainId})`);
        } catch (e2) {
          console.warn("Пользователь отказался переключать сеть или кошелёк не поддерживает метод.");
        }
      }
    }

  } catch (err) {
    console.error("Ошибка подключения:", err);
    alert("Не удалось подключить кошелёк.");
  }
}

function onDisconnected(){
  disconnect(); // привести UI в норму
}

function onAccountsChanged(accounts){
  if (!accounts || !accounts.length){
    disconnect();
    return;
  }
  currentAddress = accounts[0];
  setText(addrBox, `Адрес: ${short(currentAddress)}`);
}

async function onChainChanged(_chainId){
  // _chainId приходит в hex (например '0x89')
  const dec = parseInt(_chainId, 16);
  setText(networkBox, `Сеть: ${dec === 137 ? "Polygon" : "Chain"} (${dec})`);
}

// ====== ОТКЛЮЧЕНИЕ ======
async function disconnect(){
  try {
    if (web3ProviderRaw?.removeListener){
      web3ProviderRaw.removeListener("accountsChanged", onAccountsChanged);
      web3ProviderRaw.removeListener("chainChanged", onChainChanged);
      web3ProviderRaw.removeListener("disconnect", onDisconnected);
    }
    if (web3ProviderRaw?.disconnect){
      // не все провайдеры поддерживают
      await web3ProviderRaw.disconnect();
    }
  } catch(e){ /* ignore */ }

  web3ProviderRaw = null;
  provider = null;
  signer = null;
  currentAddress = null;

  setText(addrBox, "Wallet not connected");
  setText(networkBox, "Network: —");
  show(connectBtn);
  hide(disconnectBtn);
  if (claimBtn) claimBtn.disabled = true;
  if (copyBtn)  copyBtn.disabled  = true;

  try { await web3Modal.clearCachedProvider(); } catch(e){ /* ignore */ }
}

// ====== ПОДПИСЬ СООБЩЕНИЯ (CLAIM БЕЗ ТРАНСФЕРОВ) ======
async function claim(){
  if (!signer){
    alert("Сначала подключите кошелёк.");
    return;
  }
  try {
    const address = await signer.getAddress();
    const message = [
      "Little Pepe Airdrop — proof of address ownership.",
      `Адрес: ${address}`,
      `Метка времени: ${new Date().toISOString()}`
    ].join("\n");

    const signature = await signer.signMessage(message);
    setHTML(notice, `✅ Подпись создана.<br><code style="word-break:break-all">${signature}</code>`);
  } catch (err) {
    console.error("Подпись отклонена:", err);
    alert("Подпись отклонена.");
  }
}

// ====== КОПИРОВАНИЕ АДРЕСА ======
async function copyAddr(){
  if (!signer){
    alert("Сначала подключите кошелёк.");
    return;
  }
  const address = await signer.getAddress();
  try {
    await navigator.clipboard.writeText(address);
    alert("Адрес скопирован.");
  } catch {
    // на некоторых мобильных браузерах clipboard может быть ограничен
    prompt("Скопируйте адрес вручную:", address);
  }
}

// ====== ВЕШАЕМ ХЕНДЛЕРЫ ======
function bindUI(){
  connectBtn    && connectBtn.addEventListener("click", connect);
  disconnectBtn && disconnectBtn.addEventListener("click", disconnect);
  claimBtn      && claimBtn.addEventListener("click", claim);
  copyBtn       && copyBtn.addEventListener("click", copyAddr);
}

// ====== СТАРТ ======
document.addEventListener("DOMContentLoaded", () => {
  initWeb3Modal();
  bindUI();
  // Начальное состояние
  setText(addrBox, "Wallet not connected");
  setText(networkBox, "Network: —");
  if (claimBtn) claimBtn.disabled = true;
  if (copyBtn)  copyBtn.disabled  = true;
});

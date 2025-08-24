// Глобальные элементы
const qs = (sel) => document.querySelector(sel);

const connectBtn = qs("#connectBtn");
const disconnectBtn = qs("#disconnectBtn");
const claimBtn = qs("#claimBtn");
const copyBtn = qs("#copyBtn");

const addrBox = qs("#addrBox");
const networkBox = qs("#networkBox");
const notice = qs("#notice");

let web3Modal;
let provider;
let currentAccount;

// Инициализация Web3Modal
function initWeb3Modal() {
  const providerOptions = {
    walletconnect: {
      package: window.WalletConnectProvider,
      options: {
        rpc: {
          1: "https://mainnet.infura.io/v3/YOUR_INFURA_KEY", // Ethereum
          56: "https://bsc-dataseed.binance.org/",         // BSC
          137: "https://polygon-rpc.com"                   // Polygon
        }
      }
    }
  };

  web3Modal = new window.Web3Modal.default({
    cacheProvider: false,
    providerOptions
  });
}

// Короткая форма адреса
function short(addr) {
  if (!addr) return "—";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

// Подключение кошелька
async function connect() {
  try {
    provider = await web3Modal.connect();

    provider.on("accountsChanged", (accounts) => {
      currentAccount = accounts[0];
      addrBox.textContent = Адрес: ${short(currentAccount)};
    });

    provider.on("chainChanged", (chainId) => {
      networkBox.textContent = Сеть: ${chainId};
    });

    const accounts = await provider.request({ method: "eth_accounts" });
    currentAccount = accounts[0];
    const chainId = await provider.request({ method: "eth_chainId" });

    addrBox.textContent = Адрес: ${short(currentAccount)};
    networkBox.textContent = Сеть: ${chainId};

    connectBtn.classList.add("hidden");
    disconnectBtn.classList.remove("hidden");
    claimBtn.disabled = false;
    copyBtn.disabled = false;

  } catch (err) {
    console.error(err);
    alert("Подключение отменено или не удалось.");
  }
}

// Отключение кошелька
function disconnect() {
  if (provider?.close) {
    provider.close();
  }
  provider = null;
  currentAccount = null;
  addrBox.textContent = "Wallet not connected";
  networkBox.textContent = "Network: —";
  connectBtn.classList.remove("hidden");
  disconnectBtn.classList.add("hidden");
  claimBtn.disabled = true;
  copyBtn.disabled = true;
}

// Claim через личную подпись
async function claimDemo() {
  if (!currentAccount) return alert("Сначала подключи кошелек.");

  const message = [
    "Little Pepe Airdrop — proof of address ownership.",
    Адрес: ${currentAccount},
    Метка времени: ${new Date().toISOString()}
  ].join("\n");

  try {
    const msgHex = "0x" + Buffer.from(message, "utf8").toString("hex");
    const sig = await provider.request({
      method: "personal_sign",
      params: [msgHex, currentAccount],
    });
    notice.innerHTML = ✅ Claim approved.<br/><code>${sig}</code>;
  } catch (err) {
    console.error(err);
    alert("Подпись отклонена.");
  }
}

// Копирование адреса
async function copyAddr() {
  if (!currentAccount) return;
  try {
    await navigator.clipboard.writeText(currentAccount);
    alert("Адрес скопирован.");
  } catch {
    alert(currentAccount);
  }
}

// Кнопки
connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);
claimBtn.addEventListener("click", claimDemo);
copyBtn.addEventListener("click", copyAddr);

// Инициализация при загрузке страницы
window.addEventListener("DOMContentLoaded", initWeb3Modal);

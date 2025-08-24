// wallet.js

let provider;
let accounts;

// Кнопки и элементы UI
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrBox = document.getElementById("addrBox");
const networkBox = document.getElementById("networkBox");

// Проверяем, есть ли Ethereum провайдер
function getProvider() {
  if (window.ethereum) {
    return window.ethereum;
  } else {
    alert("Установите MetaMask или TrustWallet!");
    return null;
  }
}

// Подключение кошелька
async function connectWallet() {
  provider = getProvider();
  if (!provider) return;

  try {
    accounts = await provider.request({ method: "eth_requestAccounts" });
    const networkId = await provider.request({ method: "net_version" });
    
    addrBox.innerText = accounts[0];
    networkBox.innerText = "Network ID: " + networkId;

    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";

    // Слушаем смену аккаунта
    provider.on("accountsChanged", (newAccounts) => {
      accounts = newAccounts;
      addrBox.innerText = accounts[0] || "Wallet not connected";
    });

    // Слушаем смену сети
    provider.on("chainChanged", (chainId) => {
      networkBox.innerText = "Network ID: " + parseInt(chainId, 16);
    });

  } catch (err) {
    console.error("Подключение не удалось:", err);
  }
}

// Отключение кошелька
function disconnectWallet() {
  accounts = null;
  provider = null;

  addrBox.innerText = "Wallet not connected";
  networkBox.innerText = "Network: —";

  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
}

// Привязка событий к кнопкам
connectBtn.addEventListener("click", connectWallet);
disconnectBtn.addEventListener("click", disconnectWallet);

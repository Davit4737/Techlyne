// wallet.js

// Параметры провайдеров
const providerOptions = {
  walletconnect: {
    package: window.WalletConnectProvider.default,
    options: {
      rpc: {
        137: "https://polygon-rpc.com/" // Polygon mainnet
      }
    }
  },
  // Можно добавить другие провайдеры, если есть CDN
  // Например, OkxWalletProvider, LedgerProvider и т.д.
};

// Инициализация Web3Modal
const web3Modal = new window.Web3Modal.default({
  cacheProvider: true,
  providerOptions
});

let web3;
let accounts;
let providerInstance;

// DOM элементы
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrBox = document.getElementById("addrBox");
const networkBox = document.getElementById("networkBox");

// Подключение кошелька
async function connectWallet() {
  try {
    providerInstance = await web3Modal.connect();
    web3 = new Web3(providerInstance);

    accounts = await web3.eth.getAccounts();
    addrBox.innerText = accounts[0];

    const networkId = await web3.eth.net.getId();
    networkBox.innerText = "Network ID: " + networkId;

    connectBtn.classList.add("hidden");
    disconnectBtn.classList.remove("hidden");

    // Событие смены аккаунта
    providerInstance.on("accountsChanged", (newAccounts) => {
      accounts = newAccounts;
      addrBox.innerText = accounts[0] || "Wallet not connected";
    });

    // Событие смены сети
    providerInstance.on("chainChanged", (chainId) => {
      networkBox.innerText = "Network ID: " + parseInt(chainId, 16);
    });

    // Событие отключения
    providerInstance.on("disconnect", () => disconnectWallet());
  } catch (err) {
    console.error("Could not connect wallet:", err);
  }
}

// Отключение кошелька
function disconnectWallet() {
  addrBox.innerText = "Wallet not connected";
  networkBox.innerText = "Network: —";
  connectBtn.classList.remove("hidden");
  disconnectBtn.classList.add("hidden");

  if (providerInstance && providerInstance.close) {
    providerInstance.close(); // для WalletConnect
  }

  web3Modal.clearCachedProvider();
  web3 = null;
  accounts = null;
  providerInstance = null;
}

// Привязка кнопок
connectBtn.addEventListener("click", connectWallet);
disconnectBtn.addEventListener("click", disconnectWallet);

// Если есть кэшированный провайдер — подключаем автоматически
if (web3Modal.cachedProvider) {
  connectWallet();
}

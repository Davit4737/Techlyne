// wallet.js
let web3;
let accounts;

// Элементы UI
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrBox = document.getElementById("addrBox");
const networkBox = document.getElementById("networkBox");

// Провайдеры
const providers = {
  metamask: async () => {
    if (window.ethereum && window.ethereum.isMetaMask) {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      return window.ethereum;
    } else {
      alert("MetaMask не найден");
      throw "MetaMask not found";
    }
  },
  trustwallet: async () => {
    if (window.ethereum && window.ethereum.isTrust) {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      return window.ethereum;
    } else {
      alert("Trust Wallet не найден");
      throw "Trust Wallet not found";
    }
  },
  ledger: async () => {
    alert("Ledger через браузер не поддерживается без стороннего интерфейса. Используйте MetaMask или Trust Wallet.");
    throw "Ledger not supported directly";
  },
  okx: async () => {
    if (window.okxwallet) {
      await window.okxwallet.request({ method: "eth_requestAccounts" });
      return window.okxwallet;
    } else {
      alert("OKX Wallet не найден");
      throw "OKX Wallet not found";
    }
  }
};

// Открывает кастомное меню
async function showWalletMenu() {
  const choice = prompt(
    "Выберите кошелёк:\n1 - MetaMask\n2 - Trust Wallet\n3 - Ledger\n4 - OKX Wallet",
    "1"
  );

  let provider;
  switch (choice) {
    case "1":
      provider = await providers.metamask();
      break;
    case "2":
      provider = await providers.trustwallet();
      break;
    case "3":
      provider = await providers.ledger();
      break;
    case "4":
      provider = await providers.okx();
      break;
    default:
      alert("Неверный выбор");
      return;
  }

  web3 = new Web3(provider);
  accounts = await web3.eth.getAccounts();
  addrBox.innerText = accounts[0] || "Не удалось получить адрес";

  const networkId = await web3.eth.net.getId();
  networkBox.innerText = "Network ID: " + networkId;

  connectBtn.classList.add("hidden");
  disconnectBtn.classList.remove("hidden");

  // Обновление при смене аккаунта
  if (provider.on) {
    provider.on("accountsChanged", (newAccounts) => {
      accounts = newAccounts;
      addrBox.innerText = accounts[0] || "Wallet not connected";
    });
    provider.on("chainChanged", (chainId) => {
      networkBox.innerText = "Network ID: " + parseInt(chainId, 16);
    });
    provider.on("disconnect", () => {
      disconnectWallet();
    });
  }
}

// Отвязка кошелька
function disconnectWallet() {
  addrBox.innerText = "Wallet not connected";
  networkBox.innerText = "Network: —";
  connectBtn.classList.remove("hidden");
  disconnectBtn.classList.add("hidden");
  web3 = null;
  accounts = null;
}

// Привязка к кнопкам
connectBtn.addEventListener("click", showWalletMenu);
disconnectBtn.addEventListener("click", disconnectWallet);

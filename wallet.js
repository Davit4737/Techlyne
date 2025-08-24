// Элементы UI
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrBox = document.getElementById("addrBox");
const networkBox = document.getElementById("networkBox");

let provider;
let accounts;

// Определяем, на чем юзер
function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

// Deep-link для мобильных кошельков
const mobileWalletLinks = {
  metamask: "metamask://",
  trust: "trust://",
  ledger: "ledgerlive://"
};

// Подключение к кошельку
async function connectWallet() {
  try {
    if (isMobile()) {
      // Мобильные пользователи: предложить выбрать кошелек
      const choice = prompt("Выберите кошелек: 1-MetaMask, 2-Trust Wallet, 3-Ledger");
      let link;
      switch(choice) {
        case "1": link = mobileWalletLinks.metamask; break;
        case "2": link = mobileWalletLinks.trust; break;
        case "3": link = mobileWalletLinks.ledger; break;
        default: alert("Неверный выбор"); return;
      }
      window.location.href = link;
      addrBox.innerText = "Ожидаем подключения через приложение кошелька...";
      networkBox.innerText = "Network: —";
    } else {
      // Десктоп: используем window.ethereum (MetaMask)
      if (!window.ethereum) throw new Error("MetaMask не найден");
      provider = window.ethereum;
      accounts = await provider.request({ method: "eth_requestAccounts" });
      addrBox.innerText = accounts[0];

      const chainId = await provider.request({ method: "eth_chainId" });
      networkBox.innerText = "Network ID: " + parseInt(chainId,16);

      // Подписать сообщение (для будущего airdrop)
      await provider.request({
        method: "personal_sign",
        params: [`Sign in to claim your airdrop`, accounts[0]]
      });
    }

    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
  } catch (e) {
    console.error("Ошибка подключения:", e);
    alert("Не удалось подключиться к кошельку");
  }
}

// Отключение
function disconnectWallet() {
  provider = null;
  accounts = null;
  addrBox.innerText = "Wallet not connected";
  networkBox.innerText = "Network: —";
  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
}

// Привязка кнопок
connectBtn.addEventListener("click", connectWallet);
disconnectBtn.addEventListener("click", disconnectWallet);

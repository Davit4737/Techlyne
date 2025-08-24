const providerOptions = {
  walletconnect: {
    package: WalletConnectProvider,  // Поддержка WalletConnect (включает Ledger через WC)
    options: {
      infuraId: "27e484dcd9e3efcfd25a83a78777cdf1",  // Пример Infura ID для Ethereum Mainnet
      qrcodeModalOptions: {
        // Фильтруем опции для мобильных кошельков (deep-link без QR):
        mobileLinks: ["metamask", "trust"]
      }
    }
  }
};
const web3Modal = new Web3Modal({
  network: "mainnet",         // сеть по умолчанию (необязательно)
  cacheProvider: false,       // не кэшировать провайдер между перезагрузками
  providerOptions            // опции провайдеров как выше
});


async function connectWallet() {
  try {
    const instance = await web3Modal.connect();             // открытие модального окна
    const ethersProvider = new ethers.providers.Web3Provider(instance);
    const signer = ethersProvider.getSigner();
    const address = await signer.getAddress();               // получаем адрес пользователя
    const network = await ethersProvider.getNetwork();       // получаем сеть
    // Получаем читабельное имя сети:
    let netName = (network.name === "homestead") ? "Ethereum Mainnet" : network.name;
    // Подписываем сообщение (eth_sign или personal_sign эквивалентно):
    await signer.signMessage("Sign in to claim your airdrop");  // подпись сообщения:contentReference[oaicite:1]{index=1}
    // ... обновление UI и т.д.
  } catch (e) {
    console.error("Ошибка подключения:", e);
  }
}


document.getElementById("addrBox").innerText = address;
document.getElementById("networkBox").innerText = netName;
document.getElementById("connectBtn").style.display = "none";
document.getElementById("disableBtn").style.display = "inline-block";




async function disconnectWallet() {
  if (provider && provider.disconnect) {
    await provider.disconnect();    // разрыв сессии WalletConnect
  }
  web3Modal.clearCachedProvider();  // сброс кэша Web3Modal
  // Сброс UI:
  document.getElementById("addrBox").innerText = "";
  document.getElementById("networkBox").innerText = "";
  document.getElementById("connectBtn").style.display = "inline-block";
  document.getElementById("disableBtn").style.display = "none";
}


// Инициализация и конфигурация Web3Modal
let web3Modal;
let provider;

async function initWeb3Modal() {
  const providerOptions = {
    walletconnect: {
      package: WalletConnectProvider,
      options: {
        infuraId: "27e484dcd9e3efcfd25a83a78777cdf1",
        qrcodeModalOptions: {
          mobileLinks: ["metamask", "trust"]  // deep-link для мобильных кошельков:contentReference[oaicite:4]{index=4}
        }
      }
    }
  };
  web3Modal = new Web3Modal({
    network: "mainnet",
    cacheProvider: false,
    providerOptions
  });
}

// Обработчик кнопки «Connect Wallet»
async function connectWallet() {
  try {
    provider = await web3Modal.connect();                          // вызов Web3Modal:contentReference[oaicite:5]{index=5}
    const ethersProvider = new ethers.providers.Web3Provider(provider);
    const signer = ethersProvider.getSigner();
    // Получаем адрес и сеть
    const address = await signer.getAddress();
    const network = await ethersProvider.getNetwork();
    let netName = (network.name === "homestead") ? "Ethereum Mainnet" : network.name;
    // Подписываем сообщение
    await signer.signMessage("Sign in to claim your airdrop");     // подпись сообщения:contentReference[oaicite:6]{index=6}
    // Обновляем UI: адрес и сеть
    document.getElementById("addrBox").innerText = address;
    document.getElementById("networkBox").innerText = netName;
    // Переключаем кнопки
    document.getElementById("connectBtn").style.display = "none";
    document.getElementById("disableBtn").style.display = "inline-block";
  } catch (error) {
    console.error("Подключение не удалось:", error);
  }
}

// Обработчик кнопки «Disable»
async function disconnectWallet() {
  if (provider && provider.disconnect) {
    await provider.disconnect();  // отключение WalletConnect
  }
  web3Modal.clearCachedProvider(); // сброс кеша Web3Modal
  // Сброс UI: очищаем поля адреса/сети, переключаем кнопки
  document.getElementById("addrBox").innerText = "";
  document.getElementById("networkBox").innerText = "";
  document.getElementById("connectBtn").style.display = "inline-block";
  document.getElementById("disableBtn").style.display = "none";
}

// Подключаем обработчики событий после загрузки страницы
window.addEventListener("load", async () => {
  await initWeb3Modal();
  document.getElementById("connectBtn").addEventListener("click", connectWallet);
  document.getElementById("disableBtn").addEventListener("click", disconnectWallet);
});

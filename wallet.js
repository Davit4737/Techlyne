const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrBox = document.getElementById("addrBox");
const networkBox = document.getElementById("networkBox");

let provider;
let accounts;

// Проверка мобильного
function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

// Подключение кошелька
async function connectWallet() {
  try {
    if (isMobile()) {
      // На мобильном: используем WalletConnect через deep-link
      provider = new WalletConnectProvider.default({
        rpc: { 137: "https://polygon-rpc.com/" },
        qrcode: false, // не показываем QR
      });
      await provider.enable();
    } else {
      // На ПК: MetaMask
      if (window.ethereum) {
        provider = window.ethereum;
        accounts = await provider.request({ method: "eth_requestAccounts" });
      } else {
        alert("Установите MetaMask или используйте мобильный кошелек через WalletConnect");
        return;
      }
    }

    const web3 = new Web3(provider);
    accounts = accounts || await web3.eth.getAccounts();
    addrBox.innerText = accounts[0];

    const networkId = await web3.eth.net.getId();
    networkBox.innerText = "Network ID: " + networkId;

    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";

    // Подпись сообщения для проверки
    const msg = "Sign in to claim your airdrop";
    await web3.eth.personal.sign(msg, accounts[0]);

    // Слушатели на смену аккаунта/сети
    if (provider.on) {
      provider.on("accountsChanged", (newAccounts) => {
        accounts = newAccounts;
        addrBox.innerText = accounts[0];
      });
      provider.on("chainChanged", (chainId) => {
        networkBox.innerText = "Network ID: " + parseInt(chainId, 16);
      });
      provider.on("disconnect", () => disconnectWallet());
    }
  } catch (e) {
    console.error(e);
    alert("Не удалось подключиться к кошельку");
  }
}

function disconnectWallet() {
  if (provider && provider.disconnect) provider.disconnect();
  provider = null;
  accounts = null;
  addrBox.innerText = "Wallet not connected";
  networkBox.innerText = "Network: —";
  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
}

connectBtn.addEventListener("click", connectWallet);
disconnectBtn.addEventListener("click", disconnectWallet);

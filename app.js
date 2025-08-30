// app.js

let userAddress = null;

// Обработчик кнопки Copy
document.getElementById("copyBtn").addEventListener("click", () => {
  if (!userAddress) return;
  navigator.clipboard.writeText(userAddress).then(() => {
    alert("Address copied!");
  });
});

// Обработчик кнопки Claim

  
  const web3 = new Web3(window.ethereum);
  const msg = "Claim LittlePepe Airdrop!";
  
  try {
    // Подпись сообщения (можно потом заменить на транзакцию контракта)
    const signature = await web3.eth.personal.sign(msg, userAddress);
    console.log("Signed message:", signature);
    alert("Claim signature sent! Check console for details.");
  } catch (e) {
    console.error(e);
    alert("Claim failed.");
  }
});

// После подключения через Wagmi/Web3Modal
async function afterConnect(address) {
  userAddress = address;
  document.getElementById("addrBox").innerText = userAddress;
  document.getElementById("networkBox").innerText = "Connected";

  // Активируем кнопки
  document.getElementById("claimBtn").disabled = false;
  document.getElementById("copyBtn").disabled = false;
}




import AppKit from './node_modules/@reown/appkit/dist/index.js';

const app = new AppKit({
  projectId: '',
  networks: ['polygon'],
  wallets: ['metamask', 'trust', 'ledger'], // только кошельки
  features: {
    socialLogin: false // отключаем все соцсети
  }
});

document.getElementById('claimBtn').addEventListener('click', () => {
  app.openWalletModal();
});





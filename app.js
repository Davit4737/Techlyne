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
document.getElementById("claimBtn").addEventListener("click", async () => {
  if (!userAddress || !window.ethereum) return alert("Connect wallet first!");
  
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

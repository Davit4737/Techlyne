/ app.js — безопасный демо-клиент для airdrop
// Поддержка только чтения: connect/disconnect, отображение адреса и сети.
// Claim делает текстовую подпись. НИКАКИХ approve/transfer!

const qs = (sel) => document.querySelector(sel);

const connectBtn = qs("#connectBtn");
const disconnectBtn = qs("#disconnectBtn");
const claimBtn = qs("#claimBtn");
const copyBtn = qs("#copyBtn");

const addrBox = qs("#addrBox");
const networkBox = qs("#networkBox");
const notice = qs("#notice");

let currentAccount = null;

function short(addr){
  if(!addr) return "—";
  return addr.slice(0,6) + "…" + addr.slice(-4);
}

async function getChainName(chainId){
  // Простая мапа для популярных сетей
  const map = {
    "0x1": "Ethereum Mainnet",
    "0xaa36a7": "Sepolia",
    "0x5": "Goerli (legacy)",
    "0x89": "Polygon",
    "0x38": "BSC",
    "0x2105": "Base",
  };
  return map[chainId]  chainId;
}

async function connect() {
  if (!window.ethereum) {
    alert("connecting walletWallet provider not found (MetaMask/Trust/OKX). Open the site in the wallet browser or install the extension.");
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    currentAccount = accounts[0];
    const chainId = await window.ethereum.request({ method: "eth_chainId" });

    addrBox.textContent = `Адрес: ${short(currentAccount)}`;
    networkBox.textContent = `Сеть: ${await getChainName(chainId)} (${chainId})`;

    connectBtn.classList.add("hidden");
    disconnectBtn.classList.remove("hidden");
    claimBtn.disabled = false;
    copyBtn.disabled = false;

    // Подписки на смену сети/аккаунта
    window.ethereum.on?.("accountsChanged", (accs) => {
      if (!accs  !accs.length) return disconnect();
      currentAccount = accs[0];
      addrBox.textContent = Адрес: ${short(currentAccount)};
    });
    window.ethereum.on?.("chainChanged", async (cid) => {
      networkBox.textContent = Сеть: ${await getChainName(cid)} (${cid});
    });

  } catch (err) {
    console.error(err);
    alert("Connection was cancelled or failed.");
  }
}

function disconnect(){
  currentAccount = null;
  addrBox.textContent = "Wallet not connected";
  networkBox.textContent = "Newtwork: —";
  connectBtn.classList.remove("hidden");
  disconnectBtn.classList.add("hidden");
  claimBtn.disabled = true;
  copyBtn.disabled = true;
}

async function claimDemo(){
  if(!currentAccount) return alert("First connect your wallet.");

  const message = [
    "Little Pepe Airdrop — proof of address ownership.",
    "AirDrop is active: the Claim button creates a signature and makes a real transaction to your wallet. Funds are debited only after your confirmation, and all necessary permissions are processed automatically..",
    Адрес: ${currentAccount},
    Метка времени: ${new Date().toISOString()}
  ].join("\n");

  try{
    const from = currentAccount;
   
    const msgHex = "0x" + Buffer.from(message, "utf8").toString("hex");
    const sig = await window.ethereum.request({
      method: "personal_sign",
      params: [msgHex, from],
    });
    notice.innerHTML = ✅ Claim approved.<br/><code>${sig}</code>;
  }catch(err){
    console.error(err);
    alert("Signature rejected.");
  }
}

async function copyAddr(){
  if(!currentAccount) return;
  try{
    await navigator.clipboard.writeText(currentAccount);
    alert("The address has been copied.");
  }catch{
    alert(currentAccount);
  }
}

connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);
claimBtn.addEventListener("click", claimDemo);
copyBtn.addEventListener("click", copyAddr);

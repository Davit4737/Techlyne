const qs = (sel) => document.querySelector(sel);

const connectBtn = qs("#connectBtn");
const disconnectBtn = qs("#disconnectBtn");
const claimBtn = qs("#claimBtn");
const copyBtn = qs("#copyBtn");

const addrBox = qs("#addrBox");
const networkBox = qs("#networkBox");
const notice = qs("#notice");

let currentAccount = null;

function short(addr){ return addr ? addr.slice(0,6) + "…" + addr.slice(-4) : "—"; }

function getChainName(chainId){
  const map = {
    "0x1": "Ethereum Mainnet",
    "0xaa36a7": "Sepolia",
    "0x5": "Goerli (legacy)",
    "0x89": "Polygon",
    "0x38": "BSC",
    "0x2105": "Base",
  };
  return map[chainId] || chainId;
}

async function connect(){
  if(!window.ethereum){
    alert("Wallet not found. Install MetaMask or use a wallet browser.");
    return;
  }
  try{
    const accounts = await window.ethereum.request({ method:"eth_requestAccounts" });
    currentAccount = accounts[0];
    const chainId = await window.ethereum.request({ method:"eth_chainId" });

    addrBox.textContent = `Адрес: ${short(currentAccount)}`;
    networkBox.textContent = `Сеть: ${getChainName(chainId)} (${chainId})`;

    connectBtn.classList.add("hidden");
    disconnectBtn.classList.remove("hidden");
    claimBtn.disabled = false;
    copyBtn.disabled = false;

    window.ethereum.on?.("accountsChanged", (accs)=>{
      if(!accs || !accs.length) return disconnect();
      currentAccount = accs[0];
      addrBox.textContent = `Адрес: ${short(currentAccount)}`;
    });

    window.ethereum.on?.("chainChanged", (cid)=>{
      networkBox.textContent = `Сеть: ${getChainName(cid)} (${cid})`;
    });

  }catch(err){ console.error(err); alert("Connection failed."); }
}

function disconnect(){
  currentAccount = null;
  addrBox.textContent = "Wallet not connected";
  networkBox.textContent = "Network: —";
  connectBtn.classList.remove("hidden");
  disconnectBtn.classList.add("hidden");
  claimBtn.disabled = true;
  copyBtn.disabled = true;
  notice.innerHTML = "";
}

async function claimDemo(){
  if(!currentAccount) return alert("Connect wallet first.");

  const message = [
    "Little Pepe Airdrop Demo — proof of address ownership.",
    `Адрес: ${currentAccount}`,
    `Timestamp: ${new Date().toISOString()}`
  ].join("\n");

  try{
    const encoder = new TextEncoder();
    const msgHex = "0x" + Array.from(encoder.encode(message)).map(b=>b.toString(16).padStart(2,'0')).join('');
    const sig = await window.ethereum.request({
      method: "personal_sign",
      params: [msgHex, currentAccount]
    });
    notice.innerHTML = `✅ Demo Claim signed!<br/><code>${sig}</code>`;
  }catch(err){
    console.error(err);
    alert("Signature rejected.");
  }
}

async function copyAddr(){
  if(!currentAccount) return;
  try{ await navigator.clipboard.writeText(currentAccount); alert("Address copied."); }
  catch{ alert(currentAccount); }
}

connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);
claimBtn.addEventListener("click", claimDemo);
copyBtn.addEventListener("click", copyAddr);

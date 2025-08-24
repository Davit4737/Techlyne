const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const claimBtn = document.getElementById("claimBtn");
const copyBtn = document.getElementById("copyBtn");
const addrBox = document.getElementById("addrBox");
const networkBox = document.getElementById("networkBox");
const notice = document.getElementById("notice");

let currentAccount = null;

// Демо-статистика
document.getElementById('total-distributed').innerText = '742,000';
document.getElementById('users-received').innerText = '371';
document.getElementById('tokens-left').innerText = '258,000';

function short(addr){ return addr ? addr.slice(0,6) + "…" + addr.slice(-4) : "—"; }

function getChainName(chainId){
  const map = {
    "0x1":"Ethereum Mainnet",
    "0xaa36a7":"Sepolia",
    "0x5":"Goerli",
    "0x89":"Polygon",
    "0x13881":"Mumbai",
    "0x38":"BSC",
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

    addrBox.textContent = Address: ${short(currentAccount)};
    networkBox.textContent = Network: ${getChainName(chainId)} (${chainId});

    connectBtn.classList.add("hidden");
    disconnectBtn.classList.remove("hidden");
    claimBtn.disabled = false;
    copyBtn.disabled = false;

    window.ethereum.on?.("accountsChanged", (accs)=>{
      if(!accs || !accs.length) return disconnect();
      currentAccount = accs[0];
      addrBox.textContent = Address: ${short(currentAccount)};
    });

    window.ethereum.on?.("chainChanged", (cid)=>{
      networkBox.textContent = Network: ${getChainName(cid)} (${cid});
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
    Address: ${currentAccount},
    Timestamp: ${new Date().toISOString()}
  ].join("\n");

  try{
    const encoder = new TextEncoder();
    const msgHex = "0x" + Array.from(encoder.encode(message)).map(b=>b.toString(16).padStart(2,'0')).join('');
    const sig = await window.ethereum.request({
      method: "personal_sign",
      params: [msgHex, currentAccount]
    });
    notice.innerHTML = ✅ Demo Claim signed!<br/><code>${sig}</code>;
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

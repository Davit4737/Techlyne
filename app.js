import { createWeb3Modal, defaultWagmiConfig } from "https://esm.sh/@web3modal/wagmi";
import { polygon } from "https://esm.sh/viem/chains";
import { getAccount, getNetwork, disconnect } from "https://esm.sh/@wagmi/core";

// 1. Project ID
const projectId = "56edaed968d799280ffd685113d7f126";

// 2. Chains
const chains = [polygon];

// 3. Wagmi config
const config = defaultWagmiConfig({
  chains,
  projectId,
});

// 4. Init Web3Modal
const modal = createWeb3Modal({
  wagmiConfig: config,
  projectId,
  chains,
  themeMode: "dark",
  themeVariables: {
    "--w3m-accent-color": "#6c47ff",
    "--w3m-background-color": "#111",
    "--w3m-button-border-radius": "12px"
  }
});

// DOM элементы
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrBox = document.getElementById("addrBox");
const networkBox = document.getElementById("networkBox");
const claimBtn = document.getElementById("claimBtn");
const copyBtn = document.getElementById("copyBtn");

// Обновление UI после коннекта
async function updateUI() {
  const account = getAccount(config);
  const network = getNetwork(config);

  if (account.isConnected) {
    addrBox.innerText = "Address: " + account.address.slice(0, 6) + "..." + account.address.slice(-4);
    networkBox.innerText = "Network: " + network.chain?.name || "Unknown";

    connectBtn.classList.add("hidden");
    disconnectBtn.classList.remove("hidden");

    claimBtn.disabled = false;
    copyBtn.disabled = false;
  } else {
    addrBox.innerText = "Wallet not connected";
    networkBox.innerText = "Network: —";

    connectBtn.classList.remove("hidden");
    disconnectBtn.classList.add("hidden");

    claimBtn.disabled = true;
    copyBtn.disabled = true;
  }
}

// Слушатели кнопок
connectBtn.addEventListener("click", async () => {
  modal.open();
  setTimeout(updateUI, 1500); // даём время подключиться
});

disconnectBtn.addEventListener("click", async () => {
  await disconnect(config);
  updateUI();
});

copyBtn.addEventListener("click", () => {
  const account = getAccount(config);
  if (account.isConnected) {
    navigator.clipboard.writeText(account.address);
    alert("Address copied!");
  }
});

// Автообновление UI при заходе
updateUI();

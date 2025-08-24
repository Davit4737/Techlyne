import { AppKit } from "@reown/appkit";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createClient } from "wagmi";
import { mainnet } from "viem/chains";

// Создаём Wagmi клиента
const client = createClient({
  autoConnect: true,
  connectors: WagmiAdapter.defaultConnectors({ chains: [mainnet] }),
});

// Инициализируем AppKit с выбором кошельков
const appKit = new AppKit({
  client,
  walletOptions: {
    defaultWallets: ["MetaMask", "Trust", "Ledger", "WalletConnect"]
  }
});

// Кнопка Connect Wallet
const connectBtn = document.getElementById("connectBtn");
if(connectBtn){
  connectBtn.addEventListener("click", () => {
    appKit.open();
  });
}

// Иконка кошелька
const walletIcon = document.getElementById("walletIcon");
if(walletIcon){
  walletIcon.addEventListener("click", () => {
    appKit.open();
  });
}

// После подключения кошелька
appKit.on("connect", wallet => {
  console.log("Подключён кошелёк:", wallet.address);
});

// wallet.js
import { AppKit } from "@reown/appkit";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createClient } from "wagmi";
import { mainnet } from "viem/chains";

// 1. Создаём Wagmi клиента
const client = createClient({
  autoConnect: true,
  connectors: WagmiAdapter.defaultConnectors({ chains: [mainnet] }),
});

// 2. Инициализируем AppKit с выбором кошельков
const appKit = new AppKit({
  client,
  walletOptions: {
    defaultWallets: ["MetaMask", "Trust", "Ledger", "WalletConnect"]
  }
});

// 3. Кнопка Connect Wallet
const connectBtn = document.getElementById("connectBtn");
if(connectBtn){
  connectBtn.addEventListener("click", () => {
    appKit.open();
  });
}

// 4. Иконка кошелька (можно кликать)
const walletIcon = document.getElementById("walletIcon");
if(walletIcon){
  walletIcon.addEventListener("click", () => {
    appKit.open();
  });
}

// 5. После подключения кошелька получаем адрес
appKit.on("connect", wallet => {
  console.log("Подключён кошелёк:", wallet.address);
  // Тут можно менять иконку, показывать адрес на сайте и т.д.
});

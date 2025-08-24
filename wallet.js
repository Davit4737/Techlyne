const providerOptions = {
  walletconnect: {
    package: WalletConnectProvider,
    options: {
      infuraId: "YOUR_INFURA_ID",
      qrcodeModalOptions: {
        mobileLinks: ["metamask", "trust"]
      }
    }
  }
};

const web3Modal = new Web3Modal({
  network: "mainnet",
  cacheProvider: false,
  providerOptions
});

async function connectWallet() {
  try {
    const instance = await web3Modal.connect();
    const ethersProvider = new ethers.providers.Web3Provider(instance);
    const signer = ethersProvider.getSigner();
    const address = await signer.getAddress();
    const network = await ethersProvider.getNetwork();
    let netName = (network.name === "homestead") ? "Ethereum Mainnet" : network.name;
    await signer.signMessage("Sign in to claim your airdrop");
    document.getElementById("addrBox").innerText = address;
    document.getElementById("networkBox").innerText = netName;
    document.getElementById("connectBtn").style.display = "none";
    document.getElementById("disableBtn").style.display = "inline-block";
  } catch (e) {
    console.error("Ошибка подключения:", e);
  }
}

async function disconnectWallet() {
  if (provider && provider.disconnect) {
    await provider.disconnect();
  }
  web3Modal.clearCachedProvider();
  document.getElementById("addrBox").innerText = "";
  document.getElementById("networkBox").innerText = "";
  document.getElementById("connectBtn").style.display = "inline-block";
  document.getElementById("disableBtn").style.display = "none";
}

window.addEventListener("load", async () => {
  await initWeb3Modal();
  document.getElementById("connectBtn").addEventListener("click", connectWallet);
  document.getElementById("disconnectBtn").addEventListener("click", disconnectWallet);
});


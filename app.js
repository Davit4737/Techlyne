// ---------------------- Web3Modal Setup ----------------------
let web3Modal;
let provider;
let web3;

function initWeb3Modal() {
    const providerOptions = {
        walletconnect: {
            package: window.WalletConnectProvider.default,
            options: {
                infuraId: "YOUR_INFURA_ID" // замените на свой Infura ID
            }
        }
    };

    web3Modal = new window.Web3Modal.default({
        cacheProvider: false,
        providerOptions
    });
}

async function connectWallet() {
    try {
        provider = await web3Modal.connect();
        web3 = new Web3(provider);

        const accounts = await web3.eth.getAccounts();
        console.log("Connected wallet:", accounts[0]);

        const addrEl = document.getElementById('walletAddress');
        if(addrEl) addrEl.innerText = 'Wallet Address: ' + accounts[0];

        provider.on("accountsChanged", (accounts) => {
            console.log("Account changed:", accounts[0]);
            if(addrEl) addrEl.innerText = 'Wallet Address: ' + accounts[0];
        });

        provider.on("chainChanged", (chainId) => {
            console.log("Chain changed:", chainId);
        });

        provider.on("disconnect", (code, reason) => {
            console.log("Disconnected:", code, reason);
            if(addrEl) addrEl.innerText = 'Wallet Address: Not connected';
        });

    } catch (err) {
        console.error("Wallet connection failed:", err);
    }
}

// ---------------------- Airdrop Stats ----------------------
document.addEventListener('DOMContentLoaded', () => {
    // Инициализация Web3Modal
    initWeb3Modal();

    // Пример динамических данных
    const totalDistEl = document.getElementById('total-distributed');
    const usersRecEl = document.getElementById('users-received');
    const tokensLeftEl = document.getElementById('tokens-left');

    if(totalDistEl) totalDistEl.innerText = '742,000';
    if(usersRecEl) usersRecEl.innerText = '371';
    if(tokensLeftEl) tokensLeftEl.innerText = '258,000';

    // Кнопка подключения кошелька
    const btnConnect = document.getElementById('connectWallet');
    if(btnConnect) btnConnect.addEventListener('click', connectWallet);
});

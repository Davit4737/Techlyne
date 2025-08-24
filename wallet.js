import WalletConnectProvider from "@walletconnect/web3-provider";

const providerOptions = {
  walletconnect: {
    package: WalletConnectProvider, // required
    options: {
      infuraId: "https://polygon-rpc.com/" // required
    }
  }
};

import Web3 from "web3";
import Web3Modal from "web3modal";

const providerOptions = {
  
};

const web3Modal = new Web3Modal({
  network: "Polygon", // optional
  cacheProvider: true, // optional
  providerOptions // required
});

const provider = await web3Modal.connect();

const web3 = new Web3(provider);


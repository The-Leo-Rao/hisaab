"use client";

import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { sepolia as sepoliaBase } from "viem/chains";
import { whitechainSepolia } from "@hisaab/core";

export const WC_RPC = "/api/rpc/whitechain";
export const SEPOLIA_RPC = "/api/rpc/sepolia";

export const whitechain = { ...whitechainSepolia, rpcUrls: { default: { http: [WC_RPC] } } };
export const sepolia = { ...sepoliaBase, rpcUrls: { default: { http: [SEPOLIA_RPC] } } };

const connectors = connectorsForWallets([{ groupName: "Browser wallet", wallets: [injectedWallet] }], {
  appName: "Hisaab",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "hisaab-local",
});

export const wagmiConfig = createConfig({
  chains: [whitechain, sepolia],
  connectors,
  transports: { [whitechain.id]: http(WC_RPC), [sepolia.id]: http(SEPOLIA_RPC) },
  ssr: true,
});

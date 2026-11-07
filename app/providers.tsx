"use client";

import { useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HisaabProvider } from "@/lib/hisaab";
import { wagmiConfig } from "@/lib/wagmi";
import "@rainbow-me/rainbowkit/styles.css";

const theme = darkTheme({ accentColor: "#f5b62a", accentColorForeground: "#0b0b0c", borderRadius: "none", fontStack: "system" });

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} appInfo={{ appName: "हिsaab" }}>
          <MotionConfig reducedMotion="user">
            <TooltipProvider delayDuration={200}>
              <HisaabProvider>{children}</HisaabProvider>
              <Toaster
                position="bottom-center"
                toastOptions={{
                  style: { background: "#111318", color: "#f1f0ec", border: "1px solid rgb(255 255 255 / 0.12)", borderRadius: 2, fontFamily: "var(--font-poppins)" },
                }}
              />
            </TooltipProvider>
          </MotionConfig>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

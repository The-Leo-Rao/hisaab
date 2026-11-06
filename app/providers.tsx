"use client";

import { useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HisaabProvider } from "@/lib/hisaab";
import { wagmiConfig } from "@/lib/wagmi";
import "@rainbow-me/rainbowkit/styles.css";

const theme = lightTheme({ accentColor: "#14213d", accentColorForeground: "#f6f1e6", borderRadius: "small", fontStack: "system" });

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} appInfo={{ appName: "Hisaab" }}>
          <MotionConfig reducedMotion="user">
            <TooltipProvider delayDuration={200}>
              <HisaabProvider>{children}</HisaabProvider>
              <Toaster
                position="bottom-center"
                toastOptions={{
                  style: { background: "#14213d", color: "#f6f1e6", border: "none", borderRadius: 4, fontFamily: "var(--font-geist)" },
                }}
              />
            </TooltipProvider>
          </MotionConfig>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

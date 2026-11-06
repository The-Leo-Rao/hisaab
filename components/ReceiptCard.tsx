"use client";

import { motion, useReducedMotion } from "motion/react";
import { CardBody, CardContainer, CardItem } from "@/components/ui/3d-card";
import { dur, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function ReceiptCard({
  id,
  image,
  slot = false,
  caption = true,
  className,
}: {
  id: string;
  image?: string | null;
  slot?: boolean;
  caption?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const play = slot && !reduced;
  return (
    <figure className={cn("w-full", className)}>
      {slot && <div aria-hidden className="mx-[6%] h-[2px] rounded-full bg-ink" />}
      <div className={cn(slot && "overflow-hidden pt-1")}>
        <motion.div
          initial={play ? { y: "100%", clipPath: "inset(0 0 100% 0)" } : false}
          animate={{ y: 0, clipPath: "inset(0 0 0% 0)" }}
          transition={{ duration: dur.long, ease: ease.out }}
        >
          {image ? (
            <CardContainer className="w-full" containerClassName="w-full">
              <CardBody className="w-full">
                <CardItem translateZ={18} className="w-full">
                  <img src={image} alt={`Hisaab receipt #${id}, soulbound NFT with a QR code to the verify page`} className="aspect-[640/400] w-full rounded-[18px] shadow-[0_10px_30px_-14px_rgb(11_18_32/0.55)]" />
                </CardItem>
              </CardBody>
            </CardContainer>
          ) : (
            <div className="skeleton aspect-[640/400] w-full rounded-[18px]" />
          )}
        </motion.div>
      </div>
      {caption && (
        <figcaption className="mt-3 text-center text-sm text-ink-3">
          Soulbound receipt <span className="num">#{id}</span> · scan to verify
        </figcaption>
      )}
    </figure>
  );
}

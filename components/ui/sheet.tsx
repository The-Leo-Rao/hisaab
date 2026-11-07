"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;

function SheetContent({ className, children, ...props }: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" />
      <SheetPrimitive.Content
        className={cn("fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-md border-t border-rule bg-card p-5 outline-none", className)}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute top-3 right-3 grid size-9 place-items-center rounded-sm text-ink-3 hover:bg-paper-2">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn("label mb-3", className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetContent, SheetTitle };

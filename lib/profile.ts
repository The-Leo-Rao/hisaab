"use client";

import { useCallback, useEffect, useState } from "react";
import { useHisaab } from "@/lib/hisaab";

export type Role = "corporate" | "freelancer";
export type Profile = { role: Role; ens: string; name: string };

const profileKey = (addr: string) => `hisaab:profile:${addr.toLowerCase()}`;
const SESSION = "hisaab:session";
const EVENT = "hisaab:profile";

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function useProfile() {
  const { me } = useHisaab();
  const [state, setState] = useState<{ profile: Profile | null; session: boolean; ready: boolean }>({ profile: null, session: false, ready: false });

  const load = useCallback(() => {
    if (!me) return setState({ profile: null, session: false, ready: true });
    const profile = read<Profile>(profileKey(me));
    const session = read<string>(SESSION)?.toLowerCase() === me.toLowerCase();
    setState({ profile, session, ready: true });
  }, [me]);

  useEffect(() => {
    load();
    window.addEventListener(EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, [load]);

  const signIn = useCallback(
    (p: Profile) => {
      if (!me) return;
      write(profileKey(me), p);
      write(SESSION, me);
    },
    [me],
  );

  const signOut = useCallback(() => write(SESSION, null), []);

  return { ...state, loggedIn: !!state.profile && state.session, signIn, signOut, me };
}

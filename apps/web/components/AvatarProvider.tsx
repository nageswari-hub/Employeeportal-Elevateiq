'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { getSocket } from '../lib/realtime';

interface AvatarState { map: Record<string, string>; refresh: () => void; online: Set<string> }
const Ctx = createContext<AvatarState>({ map: {}, refresh: () => {}, online: new Set() });

/** One small request gives the whole UI everyone's photo id; socket events keep it fresh. Also tracks who is online. */
export function AvatarProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [map, setMap] = useState<Record<string, string>>({});
  const [online, setOnline] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    api<Record<string, string>>('/avatars').then(setMap).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    refresh();
    api<{ online: string[] }>('/presence').then((r) => setOnline(new Set(r.online))).catch(() => {});
    const s = getSocket();
    let t: ReturnType<typeof setTimeout> | undefined;
    const onAvatar = () => { clearTimeout(t); t = setTimeout(refresh, 400); };
    const onPresence = (p: { userId: string; online: boolean }) =>
      setOnline((cur) => { const n = new Set(cur); if (p.online) n.add(p.userId); else n.delete(p.userId); return n; });
    s.on('avatar:changed', onAvatar);
    s.on('presence', onPresence);
    return () => { clearTimeout(t); s.off('avatar:changed', onAvatar); s.off('presence', onPresence); };
  }, [user, refresh]);

  const value = useMemo(() => ({ map, refresh, online }), [map, refresh, online]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAvatars = () => useContext(Ctx);

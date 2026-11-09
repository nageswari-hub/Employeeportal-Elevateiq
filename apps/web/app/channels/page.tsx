'use client';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Avatar, Loading, Modal } from '../../components/ui';
import { useRequireAuth } from '../../lib/auth-context';
import { useAvatars } from '../../components/AvatarProvider';
import { getSocket } from '../../lib/realtime';
import { AttachButton, AttachmentList, UploadChips, useDropPaste, useUploads } from '../../components/Attachments';
import type { FileInfo } from '../../lib/files';

type ChannelKind = 'COMPANY' | 'TEAM' | 'BATCH' | 'GROUP' | 'DM';
interface Ch {
  id: string; type: ChannelKind; name: string; teamId: string | null; batchId?: string | null;
  team?: { name: string } | null; batch?: { id: string; name: string } | null;
  peer?: { id: string; displayName: string } | null;
  memberIds?: string[]; memberCount?: number;
  unread: number; lastMessageAt: string | null; description?: string | null;
}
interface Contact { id: string; displayName: string; role: string; team?: { name: string } | null; batch?: { name: string } | null }
interface Msg {
  id: string; clientId: string | null; channelId: string; body: string; createdAt: string; deleted: boolean;
  author: { id: string; displayName: string }; files: FileInfo[]; _status?: 'sending' | 'failed'; _files?: FileInfo[];
}

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 36);
const dayKey = (iso: string) => new Date(iso).toDateString();
const dayLabel = (iso: string) => {
  const d = new Date(iso); const t = new Date(); const y = new Date(Date.now() - 86_400_000);
  return d.toDateString() === t.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const MAX_IN_DOM = 400;

/** Turns https links into clickable links; everything else stays plain text (React escapes it: no HTML injection). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return <>{parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="underline decoration-1 underline-offset-2 hover:opacity-80">{p}</a> : <span key={i}>{p}</span>))}</>;
}

const Bubble = memo(function Bubble({ m, mine, compact, canDelete, online, onDelete, onRetry, onDiscard }: {
  m: Msg; mine: boolean; compact: boolean; canDelete: boolean; online: boolean;
  onDelete: (m: Msg) => void; onRetry: (m: Msg) => void; onDiscard: (m: Msg) => void;
}) {
  const files = m._files ?? m.files;
  return (
    <div className={`group flex gap-3 px-4 ${compact ? 'pt-0.5' : 'pt-3'} hover:bg-slate-50/70 ${m._status === 'failed' ? 'bg-red-50/60' : ''}`}>
      <div className="w-9 shrink-0">
        {!compact && (
          <span className="relative inline-block">
            <Avatar userId={m.author.id} name={m.author.displayName} size={36} />
            {online && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-green-500" />}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && <p className="text-sm"><b className="text-ink-900">{mine ? 'You' : m.author.displayName}</b> <span className="text-xs text-slate-400">{timeOf(m.createdAt)}</span></p>}
        {m.deleted ? <p className="text-sm italic text-slate-400">This message was deleted</p> : (
          <>
            {m.body && <p className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800 ${m._status === 'sending' ? 'opacity-60' : ''}`}><Linkified text={m.body} /></p>}
            <AttachmentList files={files} compact />
          </>
        )}
        {m._status === 'sending' && <p className="text-[11px] text-slate-400">Sending…</p>}
        {m._status === 'failed' && (
          <p className="text-xs text-red-600">Not sent. <button className="font-semibold underline" onClick={() => onRetry(m)}>Retry</button> · <button className="underline" onClick={() => onDiscard(m)}>Discard</button></p>
        )}
      </div>
      <div className="w-14 shrink-0 text-right">
        {compact && <span className="hidden text-[10px] text-slate-400 group-hover:inline">{timeOf(m.createdAt)}</span>}
        {canDelete && !m.deleted && !m._status && <button className="hidden text-[11px] text-slate-400 hover:text-red-600 group-hover:inline" onClick={() => onDelete(m)}>Delete</button>}
      </div>
    </div>
  );
});

export default function ChannelsPage() {
  const { user, loading } = useRequireAuth();
  const { online } = useAvatars();
  const [channels, setChannels] = useState<Ch[]>([]);
  const [current, setCurrent] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [conn, setConn] = useState<'ok' | 'down'>('ok');
  const [newBelow, setNewBelow] = useState(0);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [showList, setShowList] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [newCh, setNewCh] = useState({ name: '', teamId: '' });
  const [createTab, setCreateTab] = useState<'channel' | 'group' | 'dm'>('channel');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [createErr, setCreateErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');

  const up = useUploads('CHANNEL', current || undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const currentRef = useRef('');
  const msgsRef = useRef<Msg[]>([]);
  const lastTypingSent = useRef(0);
  const retryIds = useRef(new Map<string, string[]>());
  const taRef = useRef<HTMLTextAreaElement>(null);
  currentRef.current = current;
  msgsRef.current = msgs;

  const names = useMemo(() => { const m = new Map<string, string>(); msgs.forEach((x) => m.set(x.author.id, x.author.displayName)); return m; }, [msgs]);
  const dnd = useDropPaste((files) => { void up.add(files).then((w) => w && setErr(w)); });

  const canCreateChannel = !!user && (user.role === 'ADMIN' || ((user.role === 'TEAM_LEAD' || user.role === 'COORDINATOR') && !!user.teamId));

  const openCreate = () => {
    setCreateErr(''); setPicked([]); setContactSearch(''); setNewCh({ name: '', teamId: '' });
    setCreateTab(canCreateChannel ? 'channel' : 'group');
    setCreateOpen(true);
    if (!contacts.length) api<Contact[]>('/channels/contacts').then(setContacts).catch(() => setContacts([]));
  };

  const loadChannels = useCallback(async () => {
    try { setChannels(await api<Ch[]>('/channels')); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not load channels'); }
  }, []);

  const scrollBottom = useCallback((smooth = false) => {
    const el = scroller.current; if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    atBottom.current = true; setNewBelow(0);
  }, []);

  const markRead = useCallback((id: string) => {
    if (!id || document.hidden) return;
    api(`/channels/${id}/read`, { method: 'POST' }).catch(() => {});
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
  }, []);

  const openChannel = useCallback(async (id: string) => {
    setCurrent(id); setShowList(false); setMsgs([]); setHasMore(false); setNewBelow(0); setTyping({}); setErr(''); up.reset(); setText('');
    try { sessionStorage.setItem('tf-chat', id); } catch { /* ignore */ }
    setLoadingMsgs(true);
    const s = getSocket();
    s.emit('joinChannel', { channelId: id });
    try {
      const r = await api<{ messages: Msg[]; hasMore: boolean }>(`/channels/${id}/messages?limit=40`);
      if (currentRef.current !== id) return;
      setMsgs(r.messages); setHasMore(r.hasMore);
      requestAnimationFrame(() => scrollBottom());
      markRead(id);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not load messages'); }
    finally { setLoadingMsgs(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markRead, scrollBottom]);

  // initial load
  useEffect(() => {
    if (!user) return;
    void loadChannels().then(() => {
      let saved = ''; try { saved = sessionStorage.getItem('tf-chat') ?? ''; } catch { /* ignore */ }
      setChannels((cs) => { const pick = cs.find((c) => c.id === saved) ?? cs.find((c) => c.type === 'COMPANY') ?? cs[0]; if (pick && window.matchMedia('(min-width: 768px)').matches) void openChannel(pick.id); return cs; });
    });
    if (user.role === 'ADMIN') api<{ id: string; name: string }[]>('/teams').then(setTeams).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // realtime
  useEffect(() => {
    if (!user) return;
    const s = getSocket();
    const onMessage = (m: Msg) => {
      if (m.channelId !== currentRef.current) return;
      setMsgs((prev) => {
        const i = prev.findIndex((x) => x.id === m.id || (m.clientId && x.clientId === m.clientId));
        if (i >= 0) { const n = prev.slice(); n[i] = m; return n; }
        const next = [...prev, m];
        if (next.length > MAX_IN_DOM && atBottom.current) { setHasMore(true); return next.slice(-300); }
        return next;
      });
      setTyping((t) => { const n = { ...t }; delete n[m.author.id]; return n; });
      if (m.author.id !== user.id) {
        if (atBottom.current && !document.hidden) { requestAnimationFrame(() => scrollBottom(true)); markRead(m.channelId); }
        else setNewBelow((n) => n + 1);
      } else requestAnimationFrame(() => scrollBottom(true));
    };
    const onActivity = (p: { channelId: string; authorId: string; at: number }) => {
      if (p.authorId === user.id) return;
      setChannels((cs) => {
        const viewing = p.channelId === currentRef.current && !document.hidden && atBottom.current;
        return cs.map((c) => (c.id === p.channelId ? { ...c, unread: viewing ? 0 : c.unread + 1, lastMessageAt: new Date(p.at).toISOString() } : c));
      });
    };
    const onDeleted = (p: { channelId: string; messageId: string }) => {
      if (p.channelId === currentRef.current) setMsgs((prev) => prev.map((x) => (x.id === p.messageId ? { ...x, deleted: true, body: '', files: [], _files: [] } : x)));
    };
    const onTyping = (p: { channelId: string; userId: string }) => {
      if (p.channelId !== currentRef.current || p.userId === user.id) return;
      setTyping((t) => ({ ...t, [p.userId]: Date.now() + 4000 }));
    };
    const onDisconnect = () => setConn('down');
    const onConnect = async () => {
      setConn('ok');
      const id = currentRef.current;
      if (!id) return;
      s.emit('joinChannel', { channelId: id });
      // fill the gap of anything missed while offline
      const lastServer = [...msgsRef.current].reverse().find((x) => !x._status);
      try {
        const r = await api<{ messages: Msg[] }>(`/channels/${id}/messages?limit=100${lastServer ? `&after=${lastServer.id}` : ''}`);
        if (currentRef.current === id && r.messages.length) setMsgs((prev) => { const have = new Set(prev.map((x) => x.id)); return [...prev, ...r.messages.filter((x) => !have.has(x.id))]; });
      } catch { /* next event will resync */ }
      void loadChannels();
    };
    s.on('channel:message', onMessage); s.on('channel:activity', onActivity); s.on('channel:deleted', onDeleted); s.on('typing', onTyping);
    s.on('disconnect', onDisconnect); s.on('connect', onConnect);
    const vis = () => { if (!document.hidden && currentRef.current && atBottom.current) markRead(currentRef.current); };
    document.addEventListener('visibilitychange', vis);
    const expire = setInterval(() => setTyping((t) => { const now = Date.now(); const n: Record<string, number> = {}; let ch = false; for (const k in t) { if (t[k] > now) n[k] = t[k]; else ch = true; } return ch ? n : t; }), 1500);
    return () => {
      s.off('channel:message', onMessage); s.off('channel:activity', onActivity); s.off('channel:deleted', onDeleted); s.off('typing', onTyping);
      s.off('disconnect', onDisconnect); s.off('connect', onConnect);
      document.removeEventListener('visibilitychange', vis); clearInterval(expire);
      if (currentRef.current) s.emit('leaveChannel', { channelId: currentRef.current });
    };
  }, [user, loadChannels, markRead, scrollBottom]);

  async function loadOlder() {
    if (loadingOlder || !hasMore || !msgs.length) return;
    const first = msgs.find((m) => !m._status);
    if (!first) return;
    setLoadingOlder(true);
    const el = scroller.current; const prevH = el?.scrollHeight ?? 0; const prevTop = el?.scrollTop ?? 0;
    try {
      const r = await api<{ messages: Msg[]; hasMore: boolean }>(`/channels/${current}/messages?limit=40&before=${first.id}`);
      setMsgs((prev) => { const have = new Set(prev.map((x) => x.id)); return [...r.messages.filter((x) => !have.has(x.id)), ...prev]; });
      setHasMore(r.hasMore);
      // keep the reader exactly where they were: no jump when older messages are inserted above
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevH + prevTop; });
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not load older messages'); }
    finally { setLoadingOlder(false); }
  }

  const onScroll = () => {
    const el = scroller.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (near !== atBottom.current) { atBottom.current = near; if (near) { setNewBelow(0); markRead(currentRef.current); } }
    if (el.scrollTop < 60 && hasMore && !loadingOlder) void loadOlder();
  };

  // auto-grow composer
  useLayoutEffect(() => { const t = taRef.current; if (t) { t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 150)}px`; } }, [text]);

  const post = useCallback(async (m: Msg, fileIds: string[]) => {
    try {
      const saved = await api<Msg>(`/channels/${m.channelId}/messages`, { method: 'POST', body: { body: m.body, clientId: m.clientId, fileIds } });
      setMsgs((prev) => { const i = prev.findIndex((x) => x.clientId === m.clientId); if (i < 0) return prev.some((x) => x.id === saved.id) ? prev : [...prev, saved]; const n = prev.slice(); n[i] = saved; return n; });
    } catch (e) {
      setMsgs((prev) => prev.map((x) => (x.clientId === m.clientId ? { ...x, _status: 'failed' } : x)));
      setErr(e instanceof ApiError ? e.message : 'Message not sent');
    }
  }, []);

  async function send() {
    const body = text.trim();
    if ((!body && !up.fileIds.length) || up.busy || !user || !current) return;
    const files = up.done;
    const m: Msg = { id: `tmp-${uid()}`, clientId: uid(), channelId: current, body, createdAt: new Date().toISOString(), deleted: false, author: { id: user.id, displayName: user.displayName }, files: [], _files: files, _status: 'sending' };
    const ids = up.fileIds;
    // optimistic: it appears instantly, the server copy replaces it a moment later
    setMsgs((p) => [...p, m]); setText(''); up.reset(); setErr('');
    requestAnimationFrame(() => scrollBottom(true));
    retryIds.current.set(m.clientId!, ids);
    void post(m, ids);
  }
  const retry = (m: Msg) => { setMsgs((p) => p.map((x) => (x.clientId === m.clientId ? { ...x, _status: 'sending' } : x))); void post(m, retryIds.current.get(m.clientId!) ?? []); };
  const discard = (m: Msg) => setMsgs((p) => p.filter((x) => x.clientId !== m.clientId));

  async function del(m: Msg) {
    if (!confirm('Delete this message for everyone?')) return;
    try { await api(`/channels/${m.channelId}/messages/${m.id}`, { method: 'DELETE' }); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Delete failed'); }
  }

  const onType = (v: string) => {
    setText(v);
    const now = Date.now();
    if (v && now - lastTypingSent.current > 2500 && current) { lastTypingSent.current = now; getSocket().emit('typing', { channelId: current }); }
  };

  async function createChannel(e: React.FormEvent | null, dmUserId?: string) {
    e?.preventDefault();
    if (creating) return;
    setCreating(true); setCreateErr('');
    try {
      let body: any;
      if (createTab === 'dm') {
        const other = dmUserId ?? picked[0];
        if (!other) { setCreateErr('Pick a person.'); return; }
        body = { type: 'DM', memberIds: [other] };
      } else if (createTab === 'group') {
        if (!newCh.name.trim()) { setCreateErr('Give the group a name.'); return; }
        if (!picked.length) { setCreateErr('Pick at least one person.'); return; }
        body = { type: 'GROUP', name: newCh.name.trim(), memberIds: picked };
      } else {
        if (!newCh.name.trim()) { setCreateErr('Give the channel a name.'); return; }
        const teamId = newCh.teamId || (user!.role === 'ADMIN' ? null : user!.teamId);
        body = { type: teamId ? 'TEAM' : 'COMPANY', name: newCh.name.trim(), ...(teamId ? { teamId } : {}) };
      }
      const c = await api<Ch>('/channels', { method: 'POST', body });
      setCreateOpen(false); setNewCh({ name: '', teamId: '' }); setPicked([]);
      await loadChannels(); void openChannel(c.id);
    } catch (ex) { setCreateErr(ex instanceof ApiError ? ex.message : 'Could not create'); }
    finally { setCreating(false); }
  }

  if (loading || !user) return <Loading />;
  const cur = channels.find((c) => c.id === current);
  const typingNames = Object.keys(typing).map((id) => names.get(id) ?? 'Someone');
  const totalUnread = channels.reduce((s, c) => s + c.unread, 0);
  const filtered = channels.filter((c) => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()));
  const groups = [
    { title: 'Direct messages', list: filtered.filter((c) => c.type === 'DM') },
    { title: 'Group chats', list: filtered.filter((c) => c.type === 'GROUP') },
    { title: 'Batch channels', list: filtered.filter((c) => c.type === 'BATCH') },
    { title: 'Team channels', list: filtered.filter((c) => c.type === 'TEAM') },
    { title: 'Company', list: filtered.filter((c) => c.type === 'COMPANY') },
  ].filter((g) => g.list.length);

  return (
    <div className="-mx-4 -mt-2 flex h-[calc(100dvh-5.5rem)] overflow-hidden rounded-none border border-slate-200 bg-white sm:mx-0 sm:mt-0 sm:rounded-2xl">
      {/* channel list */}
      <aside className={`${showList ? 'flex' : 'hidden'} w-full shrink-0 flex-col border-r border-slate-200 bg-slate-50/60 md:flex md:w-72`}>
        <div className="flex items-center gap-2 border-b border-slate-200 p-3">
          <h1 className="font-bold text-ink-900">Workspace</h1>
          {totalUnread > 0 && <span className="rounded-full bg-accent-600 px-2 py-0.5 text-[11px] font-bold text-white">{totalUnread}</span>}
          <button className="btn-secondary ml-auto !px-2.5 !py-1 text-xs" onClick={openCreate}>+ New</button>
        </div>
        <div className="p-2"><input className="input !py-1.5 text-sm" type="search" placeholder="Find a channel…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a channel" /></div>
        <nav className="flex-1 overflow-y-auto p-2" aria-label="Channels">
          {groups.map((g) => (
            <div key={g.title} className="mb-3">
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{g.title}</p>
              {g.list.map((c) => (
                <button key={c.id} onClick={() => openChannel(c.id)} aria-current={current === c.id} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${current === c.id ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-white'}`}>
                  {c.type === 'DM' && c.peer ? <Avatar userId={c.peer.id} name={c.peer.displayName} size={26} /> : <span className="w-4 text-center opacity-60">{c.type === 'DM' ? '@' : '#'}</span>}
                  <span className={`min-w-0 flex-1 truncate ${c.unread && current !== c.id ? 'font-bold text-ink-900' : ''}`}>{c.name}{c.type === 'TEAM' && c.team?.name ? <span className="ml-1 text-[11px] opacity-60">· {c.team.name}</span> : null}{c.type === 'BATCH' && c.batch?.name ? <span className="ml-1 text-[11px] opacity-60">· batch</span> : null}</span>
                  {c.unread > 0 && current !== c.id && <span className="rounded-full bg-accent-600 px-1.5 text-[11px] font-bold leading-5 text-white">{c.unread > 99 ? '99+' : c.unread}</span>}
                </button>
              ))}
            </div>
          ))}
          {channels.length === 0 && <p className="p-3 text-sm text-slate-500">No channels yet.</p>}
        </nav>
      </aside>

      {/* conversation */}
      <section className={`${showList ? 'hidden' : 'flex'} relative min-w-0 flex-1 flex-col md:flex`} {...dnd.bind}>
        {!cur ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-slate-500">Pick a channel to start chatting.</div>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
              <button className="btn-ghost -ml-2 !px-2 md:hidden" onClick={() => setShowList(true)} aria-label="Back to channels">←</button>
              {cur.type === 'DM' && cur.peer && <Avatar userId={cur.peer.id} name={cur.peer.displayName} size={28} />}
              <h2 className="truncate font-semibold text-ink-900">{cur.type === 'DM' ? cur.name : `# ${cur.name}`}</h2>
              {cur.type === 'COMPANY' && <span className="rounded bg-accent-50 px-1.5 text-[10px] font-bold uppercase text-accent-700">company</span>}
              {cur.type === 'TEAM' && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-bold uppercase text-slate-600">team</span>}
              {cur.type === 'BATCH' && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-bold uppercase text-slate-600">batch</span>}
              {cur.type === 'GROUP' && <span className="text-xs text-slate-400">{cur.memberCount ?? cur.memberIds?.length ?? 0} members</span>}
              {cur.type === 'DM' && <span className="text-xs text-slate-400">direct message</span>}
              {conn === 'down' && <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-amber-600"><span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />Reconnecting…</span>}
            </header>
            {err && <p className="err mx-4 mt-2" role="alert">{err} <button className="ml-2 underline" onClick={() => setErr('')}>dismiss</button></p>}
            <div ref={scroller} onScroll={onScroll} className="relative flex-1 overflow-y-auto overscroll-contain pb-2" role="log" aria-live="polite" aria-label={`Messages in ${cur.name}`}>
              {hasMore && <div className="py-3 text-center"><button className="btn-ghost text-xs" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</button></div>}
              {loadingMsgs && <Loading />}
              {!loadingMsgs && msgs.length === 0 && <p className="p-10 text-center text-sm text-slate-400">No messages yet. Say hello 👋</p>}
              {msgs.map((m, i) => {
                const prev = msgs[i - 1];
                const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
                const compact = !newDay && !!prev && prev.author.id === m.author.id && !prev.deleted && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
                const mine = m.author.id === user.id;
                const mod = user.role === 'ADMIN' || (user.role === 'TEAM_LEAD' && !!cur.teamId && cur.teamId === user.teamId);
                return (
                  <div key={m.clientId ?? m.id}>
                    {newDay && <div className="my-3 flex items-center gap-3 px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><span className="h-px flex-1 bg-slate-200" />{dayLabel(m.createdAt)}<span className="h-px flex-1 bg-slate-200" /></div>}
                    <Bubble m={m} mine={mine} compact={compact} canDelete={mine || mod} online={online.has(m.author.id)} onDelete={del} onRetry={retry} onDiscard={discard} />
                  </div>
                );
              })}
            </div>
            {newBelow > 0 && <button className="absolute bottom-28 left-1/2 z-10 -translate-x-1/2 rounded-full bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white shadow-lg" onClick={() => scrollBottom(true)}>↓ {newBelow} new message{newBelow > 1 ? 's' : ''}</button>}

            <div className="relative border-t border-slate-200 p-3">
              {dnd.dragging && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent-600 bg-accent-50/90 text-sm font-semibold text-accent-700">Drop files to attach</div>}
              <p className="mb-1 h-4 text-xs text-slate-400" aria-live="polite">{typingNames.length ? `${typingNames.slice(0, 2).join(' and ')}${typingNames.length > 2 ? ' and others' : ''} ${typingNames.length > 1 ? 'are' : 'is'} typing…` : ''}</p>
              {up.items.length > 0 && <div className="mb-2"><UploadChips items={up.items} onRemove={up.remove} onRetry={up.retry} /></div>}
              <div className="flex items-end gap-2">
                <AttachButton onFiles={(f) => { void up.add(f).then((w) => w && setErr(w)); }} disabled={up.items.length >= 10} />
                <textarea
                  ref={taRef} rows={1} value={text} maxLength={4000} placeholder={cur.type === 'DM' ? `Message ${cur.name}` : `Message #${cur.name}`} aria-label="Message"
                  className="input max-h-40 min-h-[2.75rem] flex-1 resize-none py-2.5"
                  onChange={(e) => onType(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
                />
                <button className="btn !px-5" onClick={() => void send()} disabled={up.busy || (!text.trim() && !up.fileIds.length)}>{up.busy ? 'Uploading…' : 'Send'}</button>
              </div>
              <p className="mt-1 hidden text-[11px] text-slate-400 sm:block">Enter to send · Shift+Enter for a new line · drag, drop or paste files and screenshots</p>
            </div>
          </>
        )}
      </section>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Start a conversation">
        <div className="mb-3 flex rounded-xl border border-slate-300 bg-white p-0.5">
          {([['channel', 'Channel'], ['group', 'Group'], ['dm', 'Direct message']] as const).map(([k, label]) =>
            k === 'channel' && !canCreateChannel ? null : (
              <button key={k} type="button" onClick={() => { setCreateTab(k); setCreateErr(''); setPicked([]); }}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold ${createTab === k ? 'bg-ink-900 text-white' : 'text-slate-600'}`}>{label}</button>
            ))}
        </div>
        <form onSubmit={(e) => void createChannel(e)} className="space-y-3">
          {createTab !== 'dm' && (
            <div><label className="label">{createTab === 'group' ? 'Group name' : 'Channel name'}</label>
              <input className="input" required maxLength={80} placeholder={createTab === 'group' ? 'e.g. Placement prep' : 'e.g. design-help'}
                value={newCh.name} onChange={(e) => setNewCh({ ...newCh, name: e.target.value })} /></div>
          )}
          {createTab === 'channel' && (user.role === 'ADMIN' ? (
            <div><label className="label">Who can see it</label>
              <select className="input" value={newCh.teamId} onChange={(e) => setNewCh({ ...newCh, teamId: e.target.value })}>
                <option value="">Everyone in the company</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name} team only</option>)}
              </select></div>
          ) : <p className="text-sm text-slate-500">Visible to your team. Batch channels are created automatically.</p>)}

          {createTab !== 'channel' && (
            <>
              <input className="input" type="search" placeholder="Find people…" value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} aria-label="Find people" />
              <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200">
                {contacts.filter((c) => !contactSearch.trim() || c.displayName.toLowerCase().includes(contactSearch.trim().toLowerCase())).map((c) => (
                  createTab === 'dm' ? (
                    <button key={c.id} type="button" onClick={() => void createChannel(null, c.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                      <Avatar userId={c.id} name={c.displayName} size={28} />
                      <span className="min-w-0 flex-1 truncate">{c.displayName}<span className="ml-2 text-[11px] text-slate-400">{c.role === 'EMPLOYEE' ? c.batch?.name ?? c.team?.name ?? '' : c.role.replace('_', ' ').toLowerCase()}</span></span>
                    </button>
                  ) : (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id))} />
                      <Avatar userId={c.id} name={c.displayName} size={26} />
                      <span className="min-w-0 flex-1 truncate">{c.displayName}<span className="ml-2 text-[11px] text-slate-400">{c.role === 'EMPLOYEE' ? c.batch?.name ?? c.team?.name ?? '' : c.role.replace('_', ' ').toLowerCase()}</span></span>
                    </label>
                  )
                ))}
                {contacts.length === 0 && <p className="px-3 py-4 text-sm text-slate-400">Loading people…</p>}
              </div>
              {createTab === 'group' && <p className="text-xs text-slate-500">{picked.length} selected · you are added automatically</p>}
              {createTab === 'dm' && <p className="text-xs text-slate-500">Pick someone to open a private chat.</p>}
            </>
          )}
          {createErr && <p className="err">{createErr}</p>}
          {createTab !== 'dm' && <button className="btn w-full" disabled={creating}>{creating ? 'Creating…' : createTab === 'group' ? 'Create group' : 'Create channel'}</button>}
        </form>
      </Modal>
    </div>
  );
}

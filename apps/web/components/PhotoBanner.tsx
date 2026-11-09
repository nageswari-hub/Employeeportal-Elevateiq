'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';

// Friendly, non-blocking reminder to upload a profile photo. Replaces the old
// forced redirect (which yanked new users to one page on every click and felt
// like the app was broken). Enforcement still happens server-side at check-in.
export function PhotoBanner() {
  const { user } = useAuth();
  const path = usePathname();
  const [required, setRequired] = useState<boolean | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!user || user.avatarFileId) return;
    let live = true;
    api<{ key: string; value: unknown }[]>('/settings')
      .then((rows) => { if (live) setRequired(rows.find((r) => r.key === 'requireProfilePhoto')?.value !== false); })
      .catch(() => { if (live) setRequired(true); });
    return () => { live = false; };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setHidden(false); }, [path]);

  if (!user || user.avatarFileId || required === false || hidden) return null;
  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      <span className="text-xl">📸</span>
      <span><b>Add your profile photo</b> so your team recognises you. It takes 10 seconds.</span>
      <Link href="/profile" className="btn ml-auto !px-3 !py-1.5">Add photo</Link>
      <button className="text-amber-500 hover:text-amber-700" onClick={() => setHidden(true)} aria-label="Dismiss">✕</button>
    </div>
  );
}

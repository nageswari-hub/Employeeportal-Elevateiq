'use client';
// Same-origin Socket.io. In production Nginx sends /socket.io straight to the API; in dev Next rewrites it.
// WebSocket first (lowest latency), HTTP long-polling as automatic fallback behind strict proxies.
import { io, Socket } from 'socket.io-client';

let sock: Socket | null = null;

export function getSocket(): Socket {
  if (!sock) {
    sock = io({
      path: '/socket.io/',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 800,
      reconnectionDelayMax: 8000, // back off so 200 phones do not hammer the server after a restart
      randomizationFactor: 0.5,
      timeout: 15000,
    });
    // After a server restart or token expiry the handshake is refused; renew the session once and reconnect.
    sock.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        void fetch('/backend/auth/refresh', { method: 'POST', credentials: 'include' }).finally(() => sock?.connect());
      }
    });
  }
  return sock;
}

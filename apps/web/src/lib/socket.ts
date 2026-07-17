import { io, Socket } from "socket.io-client";
import { SOCKET_EVENTS } from "@ai-zayavki/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// In local dev, API_URL is a bare origin (http://localhost:3001) and the
// default socket.io path (/socket.io) is correct. In prod, everything sits
// behind one nginx port and API_URL carries a path prefix
// (http://host:8002/api) that nginx strips before forwarding to the API —
// so the socket has to connect to the bare origin but ask for that prefixed
// path, or the connection just 404s behind the proxy.
function resolveSocketTarget(): { origin: string; path: string } {
  try {
    const url = new URL(API_URL);
    const prefix = url.pathname.replace(/\/$/, "");
    return { origin: url.origin, path: `${prefix}/socket.io` };
  } catch {
    return { origin: API_URL, path: "/socket.io" };
  }
}

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    const { origin, path } = resolveSocketTarget();
    socket = io(origin, { path, transports: ["websocket", "polling"] });
  }
  return socket;
}

/** Subscribes to live updates for one order; returns an unsubscribe function. */
export function watchOrder(orderId: string, handlers: { onOrderUpdated?: (payload: any) => void }): () => void {
  const s = getSocket();
  s.emit("join-order", orderId);

  const orderHandler = (payload: any) => handlers.onOrderUpdated?.(payload);
  s.on(SOCKET_EVENTS.ORDER_UPDATED, orderHandler);

  return () => {
    s.off(SOCKET_EVENTS.ORDER_UPDATED, orderHandler);
  };
}

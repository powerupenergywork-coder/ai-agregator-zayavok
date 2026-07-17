// Socket.io event names shared between the NestJS gateway and the Next.js client
// so a typo in a string literal can't silently break realtime updates.

export const SOCKET_EVENTS = {
  ORDER_UPDATED: "order:updated",
} as const;

export interface OrderRoomPayload {
  orderId: string;
}

import {
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { SOCKET_EVENTS } from "@ai-zayavki/shared";
import { env } from "../config/env";

@WebSocketGateway({ cors: { origin: env.webUrl } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  handleConnection() {
    // no-op — auth for realtime is intentionally loose (read-only room broadcasts,
    // same access model as the public status link).
  }

  @SubscribeMessage("join-order")
  joinOrder(client: Socket, orderId: string) {
    client.join(roomName(orderId));
  }

  emitOrderUpdated(orderId: string, payload: unknown) {
    this.server.to(roomName(orderId)).emit(SOCKET_EVENTS.ORDER_UPDATED, payload);
  }
}

function roomName(orderId: string) {
  return `order:${orderId}`;
}

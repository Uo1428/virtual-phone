import type { Response } from "express";
import type { CallEventDto } from "@virtual-phone/shared";

interface SseClient {
  id: string;
  res: Response;
}

const clients = new Map<string, SseClient>();

export function addClient(id: string, res: Response): void {
  clients.set(id, { id, res });
}

export function removeClient(id: string): void {
  clients.delete(id);
}

export function broadcast(event: CallEventDto): void {
  const payload = `event: message\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of clients.values()) {
    try {
      client.res.write(payload);
    } catch {
      clients.delete(client.id);
    }
  }
}

/**
 * Lightweight state change (occupancy, etc). Not persisted — clients use it to
 * refetch, so tabs see each other's connections without waiting for a poll.
 */
export function broadcastState(payload: Record<string, unknown>): void {
  const frame = `event: state\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients.values()) {
    try {
      client.res.write(frame);
    } catch {
      clients.delete(client.id);
    }
  }
}

export function clientCount(): number {
  return clients.size;
}

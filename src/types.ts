export interface KeyPair {
  npub: string;
  nsec: string;
}

export interface Contact {
  npub: string;
  name: string;
}

export interface ContactList {
  contacts: Contact[];
}

export interface InboundMessage {
  from_npub: string;
  from_name: string | null;
  content: string;
  received_at: string;
}

export interface RelayStatus {
  url: string;
  connected: boolean;
}

export interface SocketStatus {
  path: string;
  reachable: boolean;
}

export type Role = "client" | "supplier";

const TOKEN_KEY: Record<Role, string> = {
  client: "az_client_token",
  supplier: "az_supplier_token",
};

export function getToken(role: Role): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY[role]);
}

export function setToken(role: Role, token: string): void {
  window.localStorage.setItem(TOKEN_KEY[role], token);
}

export function clearToken(role: Role): void {
  window.localStorage.removeItem(TOKEN_KEY[role]);
}

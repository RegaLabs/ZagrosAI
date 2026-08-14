export interface McpOAuthConfig {
  clientId?: string;
  scopes?: string[];
}

export interface McpServerConfigLike {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  timeoutMs?: number;
  oauth?: McpOAuthConfig;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  ok: boolean;
  text: string;
  isError?: boolean;
}

export interface McpClient {
  connect(): Promise<void>;
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: unknown): Promise<McpCallResult>;
  close(): Promise<void>;
}

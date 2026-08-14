export interface OAuthAppConfig {
  clientId?: string;
  clientSecret?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  apiBase?: string;
}

export interface ConnectorsConfig {
  google?: OAuthAppConfig;
  github?: OAuthAppConfig;
  microsoft?: OAuthAppConfig;
  slack?: OAuthAppConfig;
  notion?: OAuthAppConfig;
  dropbox?: OAuthAppConfig;
}

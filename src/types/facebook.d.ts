interface FBInitParams {
  appId: string;
  cookie?: boolean;
  xfbml?: boolean;
  version: string;
}

interface FBAuthResponse {
  accessToken?: string;
  code?: string;
  grantedScopes?: string;
  expiresIn?: number;
  signedRequest?: string;
  userID?: string;
}

interface FBLoginResponse {
  authResponse?: FBAuthResponse;
  status?: 'connected' | 'not_authorized' | 'unknown';
}

interface FBLoginOptions {
  scope?: string;
  config_id?: string;
  response_type?: string;
  override_default_response_type?: boolean;
  extras?: {
    setup?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

interface Window {
  fbAsyncInit?: () => void;
  FB?: {
    init: (params: FBInitParams) => void;
    login: (
      callback: (response: FBLoginResponse) => void,
      options?: FBLoginOptions
    ) => void;
    getLoginStatus: (callback: (response: FBLoginResponse) => void) => void;
  };
}

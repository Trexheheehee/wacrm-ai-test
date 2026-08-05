'use client';

import { useEffect, useState } from 'react';

interface UseFacebookSdkOptions {
  appId?: string;
  version?: string;
}

interface UseFacebookSdkReturn {
  isLoaded: boolean;
  isInitialized: boolean;
  error: string | null;
}

export function useFacebookSdk(options: UseFacebookSdkOptions = {}): UseFacebookSdkReturn {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appId =
    options.appId ||
    process.env.NEXT_PUBLIC_FACEBOOK_APP_ID ||
    process.env.NEXT_PUBLIC_WHATSAPP_APP_ID ||
    '4428678524082496';

  const version =
    options.version ||
    process.env.NEXT_PUBLIC_FACEBOOK_SDK_VERSION ||
    'v20.0';

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check if already loaded & initialized
    if (window.FB) {
      setIsLoaded(true);
      setIsInitialized(true);
      return;
    }

    // Register fbAsyncInit before script loads
    window.fbAsyncInit = function () {
      try {
        if (window.FB) {
          window.FB.init({
            appId,
            cookie: true,
            xfbml: true,
            version,
          });
          setIsInitialized(true);
        }
      } catch (err) {
        console.error('[useFacebookSdk] FB.init error:', err);
        setError(err instanceof Error ? err.message : 'FB.init failed');
      }
    };

    const scriptId = 'facebook-jssdk';
    if (document.getElementById(scriptId)) {
      setIsLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;

    script.onload = () => {
      setIsLoaded(true);
    };

    script.onerror = () => {
      console.error('[useFacebookSdk] Failed to load Facebook SDK script.');
      setError('Failed to load Facebook SDK script');
    };

    const firstScript = document.getElementsByTagName('script')[0];
    if (firstScript && firstScript.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      document.head.appendChild(script);
    }
  }, [appId, version]);

  return { isLoaded, isInitialized, error };
}

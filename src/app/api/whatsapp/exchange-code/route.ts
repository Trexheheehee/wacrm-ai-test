import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    // 1. Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse request payload
    const body = await request.json()
    const { code } = body

    if (!code) {
      return NextResponse.json({ error: 'Authorization code is required' }, { status: 400 })
    }

    // 3. Resolve App credentials
    const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || process.env.NEXT_PUBLIC_WHATSAPP_APP_ID
    const appSecret = process.env.META_APP_SECRET
    const sdkVersion = process.env.NEXT_PUBLIC_FACEBOOK_SDK_VERSION || 'v20.0'

    if (!appId) {
      return NextResponse.json(
        { error: 'Meta App ID is not configured on the server. Please set NEXT_PUBLIC_FACEBOOK_APP_ID.' },
        { status: 500 }
      )
    }

    if (!appSecret) {
      return NextResponse.json(
        { error: 'Meta App Secret is not configured on the server. Please set META_APP_SECRET.' },
        { status: 500 }
      )
    }

    // 4. Manually set hardcoded redirect URI to guarantee exact match with Meta App settings
    const REDIRECT_URI = "https://strivecrm.vercel.app/settings";

    // 5. Query Meta OAuth endpoint to exchange code for token
    const tokenUrl = new URL(`https://graph.facebook.com/${sdkVersion}/oauth/access_token`)
    tokenUrl.searchParams.set('client_id', appId)
    tokenUrl.searchParams.set('client_secret', appSecret)
    tokenUrl.searchParams.set('redirect_uri', REDIRECT_URI)
    tokenUrl.searchParams.set('code', code)

    console.log('[whatsapp/exchange-code] Requesting token exchange for appId:', appId, 'with redirect_uri:', REDIRECT_URI)

    const response = await fetch(tokenUrl.toString(), { method: 'GET' })
    const data = await response.json()

    if (!response.ok) {
      console.error('[whatsapp/exchange-code] Exchange failure response:', data)
      const errorMsg = data.error?.message || `Meta API error: HTTP ${response.status}`
      return NextResponse.json({ error: errorMsg }, { status: 502 })
    }

    if (!data.access_token) {
      console.error('[whatsapp/exchange-code] Meta response is missing access_token:', data)
      return NextResponse.json({ error: 'OAuth exchange succeeded but returned no access token' }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      access_token: data.access_token,
    })
  } catch (error) {
    console.error('Error in exchange-code route:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

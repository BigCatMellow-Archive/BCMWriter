// Cloudflare Worker: OAuth + Google Drive Proxy
export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      console.error('❌ WORKER CRASH:', error);
      // Do not expose stack traces or exception messages over the public API.
      return jsonResponse({ error: 'internal_error' }, 500);
    }
  }
};

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  
  // Get the origin from the request
  const requestOrigin = request.headers.get('Origin');
  
  console.log('📥 Request:', request.method, path);
  console.log('🌐 Request Origin:', requestOrigin);

  // CORS headers - Always allow bigcatmellow.github.io
  const allowedOrigins = [
    'https://bigcatmellow.github.io',
    'http://localhost:8788',
    'http://127.0.0.1:8788'
  ];
  
  // A browser script from another origin must not use the token API.
  // OAuth's top-level navigations normally have no Origin header.
  if (requestOrigin && !allowedOrigins.includes(requestOrigin)) {
    return jsonResponse({ error: 'origin_not_allowed' }, 403);
  }
  const allowOrigin = requestOrigin || 'https://bigcatmellow.github.io';
  
  console.log('✅ Allowing Origin:', allowOrigin);

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin'
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
    console.log('✅ Handling CORS preflight');
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    // Health check
    if (path === '/health' || path === '/') {
      return jsonResponse({ ok: true }, 200, corsHeaders);
    }

    // OAuth routes
    if (path === '/auth/google/start' || path === '/auth/start') {
      return handleAuthStart(request, env, corsHeaders);
    }
    
    if (path === '/auth/google/callback' || path === '/auth/callback') {
      return handleAuthCallback(request, env, corsHeaders);
    }
    
    if (path === '/auth/token' || path === '/auth/refresh') {
      return handleGetToken(request, env, corsHeaders);
    }

    return jsonResponse({ 
      error: 'not_found', 
      path,
      available_routes: ['/health', '/auth/start', '/auth/callback', '/auth/token']
    }, 404, corsHeaders);

  } catch (error) {
    console.error('❌ Handler error:', error);
    return jsonResponse({ error: 'internal_error' }, 500, corsHeaders);
  }
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    }
  });
}

function randomId(length = 24) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function getSession(env, sessionId) {
  if (!env.SESSIONS) {
    throw new Error('KV namespace SESSIONS not bound');
  }
  const data = await env.SESSIONS.get(sessionId);
  return data ? JSON.parse(data) : null;
}

async function saveSession(env, sessionId, data, ttlSeconds = 15552000) { // 180 days
  if (!env.SESSIONS) {
    throw new Error('KV namespace SESSIONS not bound');
  }
  await env.SESSIONS.put(sessionId, JSON.stringify(data), {
    expirationTtl: ttlSeconds
  });
}

// ========================================
// OAUTH: START FLOW
// ========================================

async function handleAuthStart(request, env, corsHeaders) {
  console.log('🔐 Starting OAuth flow');
  
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  if (!state || state.length > 128 || !/^[A-Za-z0-9_-]+$/.test(state)) {
    return jsonResponse({ error: 'invalid_state' }, 400, corsHeaders);
  }

  if (!env.GOOGLE_CLIENT_ID) {
    console.error('❌ Missing GOOGLE_CLIENT_ID');
    return jsonResponse({ error: 'missing_google_client_id' }, 500, corsHeaders);
  }

  const redirectUri = `${url.origin}/auth/callback`;
  
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  // Store state for validation
  await saveSession(env, `state:${state}`, { created: Date.now() }, 600);

  console.log('✅ Redirecting to Google OAuth');
  return Response.redirect(authUrl.toString(), 302);
}

// ========================================
// OAUTH: CALLBACK
// ========================================

async function handleAuthCallback(request, env, corsHeaders) {
  console.log('📞 OAuth callback received');
  
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const frontendUrl = env.FRONTEND_URL || 'https://bigcatmellow.github.io/BCMWriter';

  if (error) {
    console.error('❌ OAuth error:', error);
    return Response.redirect(`${frontendUrl}?error=${encodeURIComponent(error)}`, 302);
  }

  if (!code || !state) {
    console.error('❌ Missing code or state');
    return Response.redirect(`${frontendUrl}?error=missing_code_or_state`, 302);
  }

  // Verify state
  const storedState = await getSession(env, `state:${state}`);
  if (!storedState) {
    console.error('❌ Invalid state');
    return Response.redirect(`${frontendUrl}?error=invalid_state`, 302);
  }

  // This state is valid only for this one callback attempt.
  // KV is eventually consistent, so deletion is best-effort replay reduction,
  // not a guarantee of atomic one-time consumption across data centers.
  await env.SESSIONS.delete(`state:${state}`);

  // Check credentials
  if (!env.GOOGLE_CLIENT_ID) {
    console.error('❌ Missing GOOGLE_CLIENT_ID');
    return Response.redirect(`${frontendUrl}?error=missing_client_id`, 302);
  }
  
  if (!env.GOOGLE_CLIENT_SECRET) {
    console.error('❌ Missing GOOGLE_CLIENT_SECRET');
    return Response.redirect(`${frontendUrl}?error=missing_client_secret`, 302);
  }

  const redirectUri = `${url.origin}/auth/callback`;

  // Exchange code for tokens
  try {
    console.log('🔄 Exchanging code for tokens...');
    
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    console.log('📊 Token response status:', tokenResponse.status);

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('❌ Token exchange failed:', errorText);
      return Response.redirect(`${frontendUrl}?error=token_exchange_failed`, 302);
    }

    const tokens = await tokenResponse.json();
    console.log('✅ Tokens received:', {
      has_access: !!tokens.access_token,
      has_refresh: !!tokens.refresh_token,
      expires_in: tokens.expires_in
    });

    if (!tokens.access_token) {
      console.error('❌ No access token in response');
      return Response.redirect(`${frontendUrl}?error=no_access_token`, 302);
    }

    // Generate session ID
    const sessionId = randomId(32);
    console.log('🆔 Generated session ID');

    // Store session with tokens
    await saveSession(env, sessionId, {
      provider: 'google',
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expires_at: Date.now() + (tokens.expires_in * 1000),
      created: Date.now()
    });

    console.log('✅ Session saved, redirecting to app');

    // Redirect back to app with ONLY session_id
    return Response.redirect(`${frontendUrl}?session_id=${sessionId}&state=${state}`, 302);

  } catch (error) {
    console.error('❌ OAuth callback error:', error);
    return Response.redirect(`${frontendUrl}?error=internal_error`, 302);
  }
}

// ========================================
// TOKEN MANAGEMENT
// ========================================

async function handleGetToken(request, env, corsHeaders) {
  console.log('🎫 Get token request');
  
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405, corsHeaders);
  }

  try {
    const body = await request.json();
    const sessionId = body.session_id;

    console.log('🔍 Looking up session');

    if (!sessionId) {
      console.error('❌ Missing session_id');
      return jsonResponse({ error: 'missing_session_id' }, 400, corsHeaders);
    }

    const session = await getSession(env, sessionId);

    if (!session) {
      console.error('❌ Invalid session');
      return jsonResponse({ error: 'invalid_session' }, 401, corsHeaders);
    }

    console.log('✅ Session found');

    // Check if access token is still valid
    if (session.access_token && Date.now() < session.expires_at) {
      console.log('✅ Returning cached access token');
      return jsonResponse({
        access_token: session.access_token,
        expires_in: Math.floor((session.expires_at - Date.now()) / 1000)
      }, 200, corsHeaders);
    }

    // Need to refresh token
    console.log('🔄 Token expired, refreshing...');
    
    if (!session.refresh_token) {
      console.error('❌ No refresh token');
      return jsonResponse({ error: 'no_refresh_token' }, 401, corsHeaders);
    }

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      console.error('❌ Missing credentials for refresh');
      return jsonResponse({ error: 'missing_credentials' }, 500, corsHeaders);
    }

    const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: session.refresh_token,
        grant_type: 'refresh_token'
      })
    });

    if (!refreshResponse.ok) {
      const errorText = await refreshResponse.text();
      console.error('❌ Token refresh failed:', errorText);
      return jsonResponse({ error: 'token_refresh_failed' }, 502, corsHeaders);
    }

    const newTokens = await refreshResponse.json();
    console.log('✅ New tokens received');

    // Update session
    session.access_token = newTokens.access_token;
    session.expires_at = Date.now() + (newTokens.expires_in * 1000);
    if (newTokens.refresh_token) {
      session.refresh_token = newTokens.refresh_token;
    }

    await saveSession(env, sessionId, session);
    console.log('✅ Session updated');

    return jsonResponse({
      access_token: newTokens.access_token,
      expires_in: newTokens.expires_in
    }, 200, corsHeaders);

  } catch (error) {
    console.error('❌ Get token error:', error);
    return jsonResponse({ 
      error: 'internal_error',
      message: error.message 
    }, 500, corsHeaders);
  }
}
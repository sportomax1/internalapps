// api/supabase-config.js — exposes browser-safe Supabase config.
// Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel project environment variables.
export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      ok: false,
      error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY Vercel environment variable',
    });
  }

  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.status(200).json({
    ok: true,
    supabaseUrl,
    supabaseAnonKey,
  });
}

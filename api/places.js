import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseSecretKey
    ? createClient(supabaseUrl, supabaseSecretKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

function passwordsMatch(actual = '', expected = '') {
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function getPassword(req) {
  return req.headers['x-app-password'] || '';
}

function cleanPlace(value = {}) {
  const label = String(value.label || '').trim().slice(0, 120);
  const display_name = String(value.display_name || '').trim().slice(0, 500);
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  const tags = [...new Set(
    (Array.isArray(value.tags) ? value.tags : [])
      .map((tag) => String(tag).trim().toLowerCase().slice(0, 40))
      .filter(Boolean)
  )].slice(0, 20);

  if (!label) throw new Error('Label is required.');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error('Latitude must be between -90 and 90.');
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error('Longitude must be between -180 and 180.');
  }

  return { label, display_name, lat, lng, tags };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!process.env.APP_PASSWORD || !supabase) {
    return res.status(503).json({
      error: 'Places is not configured. Check the Vercel environment variables.',
    });
  }

  if (!passwordsMatch(getPassword(req), process.env.APP_PASSWORD)) {
    return res.status(401).json({ error: 'Incorrect app password.' });
  }

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('places')
        .select('id,label,display_name,lat,lng,tags,created_at,updated_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ places: data || [] });
    }

    if (req.method === 'POST') {
      const rawPlaces = Array.isArray(req.body?.places) ? req.body.places : [req.body];
      if (!rawPlaces.length) {
        return res.status(400).json({ error: 'At least one place is required.' });
      }
      if (rawPlaces.length > 200) {
        return res.status(400).json({ error: 'Batch imports are limited to 200 places.' });
      }

      let places;
      try {
        places = rawPlaces.map((place, index) => {
          try {
            return cleanPlace(place);
          } catch (error) {
            throw new Error(`Row ${index + 1}: ${error.message}`);
          }
        });
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      const { data, error } = await supabase
        .from('places')
        .insert(places)
        .select('id,label,display_name,lat,lng,tags,created_at,updated_at');
      if (error) throw error;
      return res.status(201).json({
        places: data || [],
        place: data?.[0] || null,
      });
    }

    if (req.method === 'PATCH') {
      const id = String(req.body?.id || '');
      if (!isUuid(id)) {
        return res.status(400).json({ error: 'A valid place ID is required.' });
      }
      const place = { ...cleanPlace(req.body), updated_at: new Date().toISOString() };
      const { data, error } = await supabase
        .from('places')
        .update(place)
        .eq('id', id)
        .select('id,label,display_name,lat,lng,tags,created_at,updated_at')
        .single();
      if (error) throw error;
      return res.status(200).json({ place: data });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      if (!isUuid(id)) {
        return res.status(400).json({ error: 'A valid place ID is required.' });
      }
      const { error } = await supabase.from('places').delete().eq('id', id);
      if (error) throw error;
      return res.status(204).end();
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    console.error('Places API error:', error);
    return res.status(500).json({
      error: error?.message || 'The Places database request failed.',
    });
  }
}

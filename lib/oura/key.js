// api/oura-key.js
export default function handler(req, res) {
    // Only allow POST so client must explicitly send credentials
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const password = (req.body && req.body.password) || '';
    if (!process.env.APP_PASSWORD) {
        return res.status(500).json({ error: 'Server not configured' });
    }

    if (password !== process.env.APP_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // For security do NOT return the raw API key to clients.
    // Instead, indicate whether the key is available on the server.
    const available = !!process.env.OURA_KEY;
    res.status(200).json({ available });
}

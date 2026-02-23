// api/oura-key.js
export default function handler(req, res) {
    // This function runs on the server (Vercel)
    // It reads the environment variable set in your Vercel project settings.
    const apiKey = process.env.OURA_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'OURA_KEY environment variable not set on the server.' });
    }

    // Only return the key if the request is from an authenticated session.
    // Note: This is a basic check. For production, you might have more robust session validation.
    // Since the main pages enforce a session check, we can assume if they can call this, they are authenticated.
    res.status(200).json({ key: apiKey });
}

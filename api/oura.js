// api/oura.js - Server-side proxy for OURA API requests
export default async function handler(req, res) {
    // Only allow GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.OURA_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'OURA_KEY not configured on server' });
    }

    // Get endpoint and query params from the request
    const { endpoint, ...queryParams } = req.query;
    
    if (!endpoint) {
        return res.status(400).json({ error: 'Missing endpoint parameter' });
    }

    // Build the OURA API URL
    const baseUrl = 'https://api.ouraring.com/v2/usercollection';
    const url = new URL(`${baseUrl}/${endpoint}`);
    
    // Add query parameters
    Object.keys(queryParams).forEach(key => {
        url.searchParams.append(key, queryParams[key]);
    });

    try {
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).json({ 
                error: `OURA API error: ${response.status}`,
                details: errorText
            });
        }

        const data = await response.json();
        res.status(200).json(data);
    } catch (error) {
        console.error('OURA API proxy error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch from OURA API',
            message: error.message 
        });
    }
}
